using System.Buffers;
using System.Net;
using System.Net.Http.Headers;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Sxsy.B122.VoiceHelper;

internal static class Program
{
    private const string RequestSchema = "sxsy-b122.voice-helper-request";
    private const string ResponseSchema = "sxsy-b122.voice-helper-response";
    private const string SelfTestSchema = "sxsy-b122.voice-helper-self-test";
    private const string ProviderRequestSchema = "sxsy-b122.voice-provider-request";
    private const string ProviderResponseSchema = "sxsy-b122.voice-provider-response";
    private const int MaximumProtocolChars = 2 * 1024 * 1024;
    private const int MaximumProviderResponseBytes = 256 * 1024;
    private const int MaximumProtectedStateBytes = 2 * 1024 * 1024;
    private const int MaximumSecretChars = 16 * 1024;
    private const int MaximumTextChars = 4096;
    private static readonly byte[] DpapiEntropy = Encoding.UTF8.GetBytes("SXSY-B122/voice-helper/v1");
    private static readonly Regex Identifier = new("^[A-Za-z0-9:._-]{1,256}$", RegexOptions.CultureInvariant);
    private static readonly Regex RouteIdentifier = new("^[a-z0-9][a-z0-9._:-]{2,127}$", RegexOptions.CultureInvariant);
    private static readonly Regex Digest = new("^[a-f0-9]{64}$", RegexOptions.CultureInvariant);
    private static readonly Regex WindowsRoot = new("^(?:[A-Za-z]:[\\\\/]|\\\\\\\\)", RegexOptions.CultureInvariant);
    private static readonly Regex SecretText = new(
        "(?:Bearer\\s+[A-Za-z0-9._~+/=-]{8,}|(?:password|secret|token|api[_-]?key)\\s*[:=]\\s*[^\\s,;]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
            if (args.Length == 1 && args[0] == "--provision-route-v1") return ProvisionRoute();
            if (args.Length == 1 && args[0] == "--remove-route-v1") return RemoveRoute();
            if (args.Length != 1 || args[0] != "--stdio-v1") return 64;
            if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
            Request request = ParseRequest(ReadBoundedLine(Console.In, MaximumProtocolChars));
            try
            {
                Handle(request);
                return 0;
            }
            catch (UnavailableException)
            {
                WriteResponse(request, "unavailable");
                return 0;
            }
        }
        catch (ProtocolException exception)
        {
            Write(new { schema = ResponseSchema, version = 1, requestId = "invalid", component = "invalid", action = "invalid", bindingId = "invalid", targetSnapshotId = "invalid", managedSessionId = "invalid", provider = (string?)null, status = "error", code = exception.Code });
            return 65;
        }
        catch
        {
            Write(new { schema = ResponseSchema, version = 1, requestId = "invalid", component = "invalid", action = "invalid", bindingId = "invalid", targetSnapshotId = "invalid", managedSessionId = "invalid", provider = (string?)null, status = "error", code = "native_failure" });
            return 70;
        }
    }

    private static void Handle(Request request)
    {
        switch (request.Action)
        {
            case "audio_open": AudioOpen(request); return;
            case "capture": Capture(request); return;
            case "speak": Speak(request); return;
            case "set_muted": SetMuted(request); return;
            case "interrupt": Interrupt(request); return;
            case "close": Close(request); return;
            case "delete_transcript": DeleteTranscript(request); return;
            case "observe": Observe(request); return;
            case "provider_open": ProviderOpen(request); return;
            case "respond": Respond(request); return;
            default: throw new ProtocolException("invalid_action");
        }
    }

    private static void AudioOpen(Request request)
    {
        RequireComponent(request, "audio");
        request.Scope.RequireFreshConsent();
        SessionState state = new(request.Scope, "audio", "active", null, DateTimeOffset.UtcNow.ToString("O"), null);
        WriteState(state);
        WriteResponse(request, "ok");
    }

    private static void Capture(Request request)
    {
        RequireComponent(request, "audio");
        SessionState state = ReadExactState(request, "audio");
        if (state.Status != "active") throw new UnavailableException();
        byte[] pcm;
        try { pcm = WinMmAudio.CapturePcm16Mono(16000, TimeSpan.FromSeconds(2)); }
        catch (WinMmAudio.AudioUnavailableException) { throw new UnavailableException(); }
        WriteResponse(request, "ok", new Dictionary<string, object?>
        {
            ["frames"] = WinMmAudio.HasVoiceActivity(pcm)
                ? new[] { new { sequence = 0, capturedAt = DateTimeOffset.UtcNow.ToString("O"), sampleRateHz = 16000, channels = 1, encoding = "pcm_s16le", dataBase64 = Convert.ToBase64String(pcm) } }
                : Array.Empty<object>()
        });
        CryptographicOperations.ZeroMemory(pcm);
    }

    private static void Speak(Request request)
    {
        RequireComponent(request, "audio");
        _ = ReadExactState(request, "audio");
        string text = RequiredText(request.Root, "responseText", MaximumTextChars);
        if (SecretText.IsMatch(text)) throw new ProtocolException("unredacted_speech");
        try { WindowsSpeech.Speak(text); }
        catch (WindowsSpeech.UnavailableExceptionProxy) { throw new UnavailableException(); }
        WriteResponse(request, "ok");
    }

    private static void SetMuted(Request request)
    {
        RequireComponent(request, "audio");
        SessionState state = ReadExactState(request, "audio");
        bool muted = RequiredBoolean(request.Root, "muted");
        WriteState(state with { Status = muted ? "muted" : "active", UpdatedAt = DateTimeOffset.UtcNow.ToString("O") });
        WriteResponse(request, "ok");
    }

    private static void Interrupt(Request request)
    {
        SessionState state = ReadExactState(request, request.Component);
        if (request.Component == "audio") WriteState(state with { Status = "interrupted", UpdatedAt = DateTimeOffset.UtcNow.ToString("O") });
        else WriteState(state with { LastInterruptedAt = DateTimeOffset.UtcNow.ToString("O"), UpdatedAt = DateTimeOffset.UtcNow.ToString("O") });
        WriteResponse(request, "ok");
    }

    private static void Close(Request request)
    {
        RequireKnownComponent(request);
        if (request.Component == "provider")
        {
            SessionState state = ReadExactState(request, "provider");
            WriteState(state with { Status = "ended", UpdatedAt = DateTimeOffset.UtcNow.ToString("O") });
        }
        else DeleteState(request.Scope.BindingId, request.Component);
        WriteResponse(request, "ok");
    }

    private static void DeleteTranscript(Request request)
    {
        RequireKnownComponent(request);
        if (request.Component == "provider")
        {
            SessionState state = ReadExactState(request, "provider");
            RouteConfig route = ReadExactRoute(request);
            ProviderDelete(request, state, route);
            DeleteState(request.Scope.BindingId, "provider");
        }
        else
        {
            // Audio is never persisted, but its exact lifecycle state is. Remove
            // that metadata so a transcript deletion also forgets the binding.
            DeleteState(request.Scope.BindingId, "audio");
        }
        WriteResponse(request, "ok");
    }

    private static void Observe(Request request)
    {
        RequireKnownComponent(request);
        string state = "absent";
        try
        {
            SessionState current = ReadExactState(request, request.Component);
            if (current.Status is "active" or "muted" or "interrupted") state = "active";
        }
        catch (UnavailableException) { }
        WriteResponse(request, "ok", new Dictionary<string, object?> { ["state"] = state });
    }

    private static void ProviderOpen(Request request)
    {
        RequireComponent(request, "provider");
        request.Scope.RequireFreshConsent();
        ValidateContext(request);
        RouteConfig route = ReadExactRoute(request);
        string externalSessionId = request.Scope.VoiceSessionId;
        WriteState(new SessionState(request.Scope, "provider", "active", externalSessionId, DateTimeOffset.UtcNow.ToString("O"), null));
        _ = route;
        WriteResponse(request, "ok", new Dictionary<string, object?> { ["externalSessionId"] = externalSessionId });
    }

    private static void Respond(Request request)
    {
        RequireComponent(request, "provider");
        ValidateContext(request);
        SessionState state = ReadExactState(request, "provider");
        if (state.Status != "active" || state.ExternalSessionId is null) throw new UnavailableException();
        RouteConfig route = ReadExactRoute(request);
        JsonElement result = CallProvider(request, state, route, "respond");
        string externalSessionId = RequiredIdentifier(result, "externalSessionId");
        if (externalSessionId != state.ExternalSessionId) throw new ProtocolException("provider_session_changed");
        WriteResponse(request, "ok", new Dictionary<string, object?>
        {
            ["externalSessionId"] = externalSessionId,
            ["recognizedText"] = RequiredText(result, "recognizedText", MaximumTextChars, allowEmpty: true),
            ["responseText"] = RequiredText(result, "responseText", MaximumTextChars)
        });
    }

    private static JsonElement CallProvider(Request request, SessionState state, RouteConfig route, string operation)
    {
        var envelope = new Dictionary<string, object?>
        {
            ["schema"] = ProviderRequestSchema,
            ["version"] = 1,
            ["operation"] = operation,
            ["provider"] = request.Provider,
            ["routeId"] = route.RouteId,
            ["model"] = route.Model,
            ["externalSessionId"] = state.ExternalSessionId,
            ["bindingId"] = request.Scope.BindingId,
            ["targetSnapshotId"] = request.Scope.TargetSnapshotId,
            ["managedSessionId"] = request.Scope.ManagedSessionId,
            ["context"] = request.Root.TryGetProperty("context", out JsonElement context) ? context.Clone() : null,
            ["frames"] = request.Root.TryGetProperty("frames", out JsonElement frames) ? frames.Clone() : null
        };
        byte[] body = JsonSerializer.SerializeToUtf8Bytes(envelope);
        if (body.Length > MaximumProtocolChars) throw new ProtocolException("provider_request_oversized");
        using var handler = new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false, AutomaticDecompression = DecompressionMethods.None };
        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(25) };
        using var message = new HttpRequestMessage(HttpMethod.Post, route.Endpoint);
        message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", route.Secret);
        message.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        message.Content = new ByteArrayContent(body);
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        HttpResponseMessage response;
        try { response = client.Send(message, HttpCompletionOption.ResponseHeadersRead); }
        catch { throw new UnavailableException(); }
        using (response)
        {
            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden or HttpStatusCode.NotFound || !response.IsSuccessStatusCode) throw new UnavailableException();
            byte[] responseBytes = ReadBounded(response.Content.ReadAsStream(), MaximumProviderResponseBytes);
            using JsonDocument document = JsonDocument.Parse(responseBytes);
            JsonElement root = document.RootElement;
            if (RequiredString(root, "schema", 128) != ProviderResponseSchema || RequiredInteger(root, "version") != 1
                || RequiredString(root, "provider", 32) != request.Provider
                || RequiredIdentifier(root, "bindingId") != request.Scope.BindingId
                || RequiredDigest(root, "targetSnapshotId") != request.Scope.TargetSnapshotId
                || RequiredIdentifier(root, "managedSessionId") != request.Scope.ManagedSessionId)
                throw new ProtocolException("provider_response_scope_changed");
            return root.Clone();
        }
    }

    private static void ProviderDelete(Request request, SessionState state, RouteConfig route)
    {
        JsonElement result = CallProvider(request, state, route, "delete_transcript");
        if (!result.TryGetProperty("deleted", out JsonElement deleted) || deleted.ValueKind != JsonValueKind.True)
            throw new ProtocolException("provider_transcript_not_deleted");
    }

    private static RouteConfig ReadExactRoute(Request request)
    {
        string authorizationReference = RequiredAuthorizationReference(request.Root, "authorizationReference");
        string routeId = RequiredRoute(request.Root, "routeId");
        RouteConfig? route;
        try { route = ReadProtected<RouteConfig>(RoutePath(authorizationReference)); }
        catch { throw new UnavailableException(); }
        if (route is null || route.Schema != "sxsy-b122.voice-route" || route.Version != 1 || route.Provider != request.Provider
            || route.RouteId != routeId || route.AuthorizationReference != authorizationReference || route.Secret.Length is < 1 or > MaximumSecretChars)
            throw new UnavailableException();
        ValidateEndpoint(route.Endpoint);
        return route;
    }

    private static int ProvisionRoute()
    {
        if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
        using JsonDocument document = JsonDocument.Parse(ReadBoundedLine(Console.In, MaximumProtocolChars));
        JsonElement root = document.RootElement;
        if (!RequiredBoolean(root, "currentUserConfirmed") || RequiredString(root, "confirmation", 64) != "PROVISION B122 VOICE ROUTE")
            throw new ProtocolException("presence_required");
        string operatorPresenceId = RequiredIdentifier(root, "operatorPresenceId");
        string provider = RequiredProvider(root, "provider");
        string routeId = RequiredRoute(root, "routeId");
        string authorizationReference = RequiredAuthorizationReference(root, "authorizationReference");
        Uri endpoint = ValidateEndpoint(RequiredString(root, "endpoint", 2048));
        string model = RequiredString(root, "model", 256);
        string secret = RequiredString(root, "secret", MaximumSecretChars);
        RouteConfig route = new("sxsy-b122.voice-route", 1, provider, routeId, authorizationReference, endpoint, model, secret, operatorPresenceId, DateTimeOffset.UtcNow.ToString("O"));
        WriteProtectedAtomic(RoutePath(authorizationReference), route);
        Write(new { schema = "sxsy-b122.voice-route-admin", version = 1, status = "installed", provider, routeId, authorizationReference });
        return 0;
    }

    private static int RemoveRoute()
    {
        if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
        using JsonDocument document = JsonDocument.Parse(ReadBoundedLine(Console.In, MaximumProtocolChars));
        JsonElement root = document.RootElement;
        if (!RequiredBoolean(root, "currentUserConfirmed") || RequiredString(root, "confirmation", 64) != "REMOVE B122 VOICE ROUTE")
            throw new ProtocolException("presence_required");
        _ = RequiredIdentifier(root, "operatorPresenceId");
        string authorizationReference = RequiredAuthorizationReference(root, "authorizationReference");
        string path = RoutePath(authorizationReference);
        DeleteProtectedFile(path);
        Write(new { schema = "sxsy-b122.voice-route-admin", version = 1, status = "removed", authorizationReference });
        return 0;
    }

    private static int SelfTest()
    {
        bool constants = RequestSchema == "sxsy-b122.voice-helper-request" && ResponseSchema == "sxsy-b122.voice-helper-response";
        bool redaction = SecretText.IsMatch("Authorization: Bearer abcdefgh") && !SecretText.IsMatch("bounded response");
        bool identity = StateStem("binding-1", "audio") == StateStem("binding-1", "audio") && StateStem("binding-1", "audio") != StateStem("binding-1", "provider");
        bool protectedRoundTrip = false;
        if (OperatingSystem.IsWindows())
        {
            string path = Path.Combine(Path.GetTempPath(), $"sxsy-b122-voice-self-test-{Guid.NewGuid():N}.bin");
            try
            {
                var value = new SelfTestValue("bounded", 1);
                WriteProtectedAtomic(path, value);
                protectedRoundTrip = ReadProtected<SelfTestValue>(path) == value && !Encoding.UTF8.GetString(File.ReadAllBytes(path)).Contains("bounded", StringComparison.Ordinal);
            }
            finally { if (File.Exists(path)) File.Delete(path); }
        }
        bool ok = OperatingSystem.IsWindows() && constants && redaction && identity && protectedRoundTrip;
        Write(new { schema = SelfTestSchema, version = 1, status = ok ? "ok" : "failed", hardwareAccessed = false, networkAccessed = false, dpapiCurrentUser = protectedRoundTrip, microphoneAcceptance = false, providerAcceptance = false });
        return ok ? 0 : 1;
    }

    private static Request ParseRequest(string line)
    {
        JsonDocument document;
        try { document = JsonDocument.Parse(line); }
        catch { throw new ProtocolException("invalid_json"); }
        JsonElement root = document.RootElement.Clone();
        document.Dispose();
        if (RequiredString(root, "schema", 128) != RequestSchema || RequiredInteger(root, "version") != 1) throw new ProtocolException("invalid_schema");
        string requestId = RequiredIdentifier(root, "requestId");
        string component = RequiredString(root, "component", 16);
        if (component is not ("audio" or "provider")) throw new ProtocolException("invalid_component");
        string action = RequiredString(root, "action", 64);
        string routeId = RequiredRoute(root, "routeId");
        Scope scope = Scope.Parse(RequiredObject(root, "scope"));
        string? provider = component == "provider" ? RequiredProvider(root, "provider") : null;
        if (provider is not null && provider != scope.Provider) throw new ProtocolException("provider_scope_mismatch");
        return new Request(root, requestId, component, action, routeId, scope, provider);
    }

    private static void ValidateContext(Request request)
    {
        JsonElement context = RequiredObject(request.Root, "context");
        if (RequiredString(context, "schema", 128) != "sxsy-b122.voice-context" || RequiredInteger(context, "version") != 1
            || RequiredIdentifier(context, "packageId") != request.Scope.ContextPackageId
            || RequiredDigest(context, "digest") != request.Scope.ContextDigest
            || RequiredDigest(context, "targetSnapshotId") != request.Scope.TargetSnapshotId
            || RequiredIdentifier(context, "managedSessionId") != request.Scope.ManagedSessionId
            || !SameWindowsPath(RequiredString(context, "repositoryRoot", 32767), request.Scope.RepositoryRoot)
            || !context.TryGetProperty("executionAuthorized", out JsonElement executionAuthorized) || executionAuthorized.ValueKind != JsonValueKind.False)
            throw new ProtocolException("context_scope_mismatch");
    }

    private static void RequireComponent(Request request, string component)
    {
        if (request.Component != component) throw new ProtocolException("component_action_mismatch");
    }

    private static void RequireKnownComponent(Request request)
    {
        if (request.Component is not ("audio" or "provider")) throw new ProtocolException("invalid_component");
    }

    private static SessionState ReadExactState(Request request, string component)
    {
        SessionState? state;
        try { state = ReadProtected<SessionState>(StatePath(request.Scope.BindingId, component)); }
        catch { throw new UnavailableException(); }
        if (state is null || state.Component != component || state.Scope != request.Scope) throw new UnavailableException();
        return state;
    }

    private static void WriteState(SessionState state) => WriteProtectedAtomic(StatePath(state.Scope.BindingId, state.Component), state);

    private static void DeleteState(string bindingId, string component)
    {
        string path = StatePath(bindingId, component);
        DeleteProtectedFile(path);
    }

    private static string StatePath(string bindingId, string component) => Path.Combine(StateDirectory(), $"{StateStem(bindingId, component)}.state");
    private static string RoutePath(string authorizationReference) => Path.Combine(RouteDirectory(), $"{HexSha256(authorizationReference)}.route");
    private static string StateStem(string bindingId, string component) => HexSha256($"{component}\0{bindingId}");
    private static string StateDirectory() => EnsureDirectory("sessions");
    private static string RouteDirectory() => EnsureDirectory("routes");

    private static string EnsureDirectory(string leaf)
    {
        string basePath = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData, Environment.SpecialFolderOption.DoNotVerify);
        if (string.IsNullOrWhiteSpace(basePath)) throw new ProtocolException("local_app_data_unavailable");
        string path = Path.GetFullPath(basePath);
        foreach (string segment in new[] { "STRATHEX", "switchyard", "voice-helper", leaf })
        {
            path = Path.GetFullPath(Path.Combine(path, segment));
            Directory.CreateDirectory(path);
            AssertProtectedDirectory(path);
        }
        return path;
    }

    private static void WriteProtectedAtomic<T>(string path, T value)
    {
        string directory = Path.GetDirectoryName(Path.GetFullPath(path)) ?? throw new ProtocolException("protected_state_path_invalid");
        Directory.CreateDirectory(directory);
        AssertProtectedDirectory(directory);
        if (File.Exists(path)) AssertProtectedFile(path);
        byte[] plaintext = JsonSerializer.SerializeToUtf8Bytes(value);
        byte[] ciphertext = Dpapi.Protect(plaintext, DpapiEntropy);
        CryptographicOperations.ZeroMemory(plaintext);
        string temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(ciphertext);
                stream.Flush(flushToDisk: true);
            }
            File.Move(temporary, path, overwrite: true);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(ciphertext);
            if (File.Exists(temporary)) File.Delete(temporary);
        }
    }

    private static T? ReadProtected<T>(string path)
    {
        AssertProtectedFile(path);
        byte[] ciphertext = File.ReadAllBytes(path);
        byte[] plaintext = Dpapi.Unprotect(ciphertext, DpapiEntropy);
        try { return JsonSerializer.Deserialize<T>(plaintext); }
        finally
        {
            CryptographicOperations.ZeroMemory(ciphertext);
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private static void DeleteProtectedFile(string path)
    {
        if (!File.Exists(path)) return;
        AssertProtectedFile(path);
        File.Delete(path);
    }

    private static void AssertProtectedDirectory(string path)
    {
        FileAttributes attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.Directory) == 0 || (attributes & FileAttributes.ReparsePoint) != 0)
            throw new ProtocolException("protected_state_directory_unsafe");
    }

    private static void AssertProtectedFile(string path)
    {
        var item = new FileInfo(path);
        if (!item.Exists || (item.Attributes & FileAttributes.ReparsePoint) != 0 || item.Length is < 1 or > MaximumProtectedStateBytes)
            throw new ProtocolException("protected_state_file_unsafe");
    }

    private static Uri ValidateEndpoint(string value) => ValidateEndpoint(new Uri(value, UriKind.Absolute));
    private static Uri ValidateEndpoint(Uri endpoint)
    {
        if (endpoint.Scheme != Uri.UriSchemeHttps || endpoint.Port != 443 || !string.IsNullOrEmpty(endpoint.UserInfo)
            || !string.IsNullOrEmpty(endpoint.Query) || !string.IsNullOrEmpty(endpoint.Fragment) || endpoint.HostNameType is UriHostNameType.Unknown or UriHostNameType.Basic)
            throw new ProtocolException("invalid_provider_endpoint");
        return endpoint;
    }

    private static void WriteResponse(Request request, string status, Dictionary<string, object?>? extra = null)
    {
        var response = new Dictionary<string, object?>
        {
            ["schema"] = ResponseSchema,
            ["version"] = 1,
            ["requestId"] = request.RequestId,
            ["component"] = request.Component,
            ["action"] = request.Action,
            ["bindingId"] = request.Scope.BindingId,
            ["targetSnapshotId"] = request.Scope.TargetSnapshotId,
            ["managedSessionId"] = request.Scope.ManagedSessionId,
            ["provider"] = request.Provider,
            ["status"] = status
        };
        if (extra is not null) foreach ((string key, object? value) in extra) response[key] = value;
        Write(response);
    }

    private static string ReadBoundedLine(TextReader reader, int maximumChars)
    {
        var builder = new StringBuilder(Math.Min(maximumChars, 4096));
        while (true)
        {
            int next = reader.Read();
            if (next < 0 || next == '\n') break;
            if (next == '\r') continue;
            if (builder.Length >= maximumChars) throw new ProtocolException("request_oversized");
            builder.Append((char)next);
        }
        if (builder.Length == 0) throw new ProtocolException("request_missing");
        return builder.ToString();
    }

    private static byte[] ReadBounded(Stream stream, int maximumBytes)
    {
        using var output = new MemoryStream();
        byte[] buffer = ArrayPool<byte>.Shared.Rent(8192);
        try
        {
            while (true)
            {
                int read = stream.Read(buffer, 0, buffer.Length);
                if (read == 0) break;
                if (output.Length + read > maximumBytes) throw new ProtocolException("provider_response_oversized");
                output.Write(buffer, 0, read);
            }
            return output.ToArray();
        }
        finally { ArrayPool<byte>.Shared.Return(buffer, clearArray: true); }
    }

    private static JsonElement RequiredObject(JsonElement parent, string name)
    {
        if (!parent.TryGetProperty(name, out JsonElement value) || value.ValueKind != JsonValueKind.Object) throw new ProtocolException($"invalid_{name}");
        return value;
    }

    private static string RequiredString(JsonElement parent, string name, int maximum, bool allowEmpty = false)
    {
        if (!parent.TryGetProperty(name, out JsonElement value) || value.ValueKind != JsonValueKind.String) throw new ProtocolException($"invalid_{name}");
        string result = value.GetString()!;
        if ((!allowEmpty && string.IsNullOrWhiteSpace(result)) || result.Length > maximum || result.IndexOf('\0') >= 0) throw new ProtocolException($"invalid_{name}");
        return result;
    }

    private static string RequiredText(JsonElement parent, string name, int maximum, bool allowEmpty = false) => RequiredString(parent, name, maximum, allowEmpty).Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ').Trim();
    private static string RequiredIdentifier(JsonElement parent, string name) { string value = RequiredString(parent, name, 256); if (!Identifier.IsMatch(value)) throw new ProtocolException($"invalid_{name}"); return value; }
    private static string RequiredRoute(JsonElement parent, string name) { string value = RequiredString(parent, name, 128); if (!RouteIdentifier.IsMatch(value)) throw new ProtocolException($"invalid_{name}"); return value; }
    private static string RequiredDigest(JsonElement parent, string name) { string value = RequiredString(parent, name, 64); if (!Digest.IsMatch(value)) throw new ProtocolException($"invalid_{name}"); return value; }
    private static string RequiredProvider(JsonElement parent, string name) { string value = RequiredString(parent, name, 32); if (value is not ("claude" or "chatgpt" or "system")) throw new ProtocolException($"invalid_{name}"); return value; }
    private static string RequiredAuthorizationReference(JsonElement parent, string name) { string value = RequiredString(parent, name, 256); if (!value.StartsWith("credential-ref:", StringComparison.Ordinal) || !Identifier.IsMatch(value)) throw new ProtocolException($"invalid_{name}"); return value; }
    private static int RequiredInteger(JsonElement parent, string name) { if (!parent.TryGetProperty(name, out JsonElement value) || !value.TryGetInt32(out int result)) throw new ProtocolException($"invalid_{name}"); return result; }
    private static bool RequiredBoolean(JsonElement parent, string name) { if (!parent.TryGetProperty(name, out JsonElement value) || value.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) throw new ProtocolException($"invalid_{name}"); return value.GetBoolean(); }
    private static bool SameWindowsPath(string left, string right) => string.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    private static string HexSha256(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static void Write(object value) => Console.Out.WriteLine(JsonSerializer.Serialize(value));

    private sealed record Request(JsonElement Root, string RequestId, string Component, string Action, string RouteId, Scope Scope, string? Provider);
    private sealed record SessionState(Scope Scope, string Component, string Status, string? ExternalSessionId, string UpdatedAt, string? LastInterruptedAt);
    private sealed record RouteConfig(string Schema, int Version, string Provider, string RouteId, string AuthorizationReference, Uri Endpoint, string Model, string Secret, string InstalledBy, string InstalledAt);
    private sealed record SelfTestValue(string Value, int Version);

    private sealed record Scope(
        string BindingId,
        string ConsentId,
        string VoiceSessionId,
        string ManagedSessionId,
        string RepositoryRoot,
        string TargetSnapshotId,
        string ContextPackageId,
        string ContextDigest,
        string Provider,
        string OperatorPresenceId,
        string ConsentExpiresAt,
        string Transcript)
    {
        internal static Scope Parse(JsonElement root)
        {
            string repositoryRoot = RequiredString(root, "repositoryRoot", 32767);
            if (!WindowsRoot.IsMatch(repositoryRoot)) throw new ProtocolException("invalid_repositoryRoot");
            string expires = RequiredString(root, "consentExpiresAt", 64);
            if (!DateTimeOffset.TryParse(expires, out _)) throw new ProtocolException("invalid_consentExpiresAt");
            string transcript = RequiredString(root, "transcript", 16);
            if (transcript is not ("off" or "redacted")) throw new ProtocolException("invalid_transcript");
            return new Scope(
                RequiredIdentifier(root, "bindingId"), RequiredIdentifier(root, "consentId"), RequiredIdentifier(root, "voiceSessionId"),
                RequiredIdentifier(root, "managedSessionId"), Path.GetFullPath(repositoryRoot), RequiredDigest(root, "targetSnapshotId"),
                RequiredIdentifier(root, "contextPackageId"), RequiredDigest(root, "contextDigest"), RequiredProvider(root, "provider"),
                RequiredIdentifier(root, "operatorPresenceId"), expires, transcript);
        }

        internal void RequireFreshConsent()
        {
            if (!DateTimeOffset.TryParse(ConsentExpiresAt, out DateTimeOffset expires) || expires <= DateTimeOffset.UtcNow || expires > DateTimeOffset.UtcNow.AddHours(24))
                throw new ProtocolException("consent_expired");
        }
    }

    private sealed class ProtocolException : Exception { internal string Code { get; } internal ProtocolException(string code) : base(code) { Code = code; } }
    private sealed class UnavailableException : Exception { }
}

internal static class WindowsSpeech
{
    internal static void Speak(string text)
    {
        Type? type = Type.GetTypeFromProgID("SAPI.SpVoice", throwOnError: false);
        if (type is null) throw new UnavailableExceptionProxy();
        object? voice = null;
        try
        {
            voice = Activator.CreateInstance(type) ?? throw new UnavailableExceptionProxy();
            _ = type.InvokeMember("Speak", BindingFlags.InvokeMethod, null, voice, new object[] { text, 0 });
        }
        catch (UnavailableExceptionProxy) { throw; }
        catch { throw new UnavailableExceptionProxy(); }
        finally { if (voice is not null && Marshal.IsComObject(voice)) Marshal.FinalReleaseComObject(voice); }
    }

    internal sealed class UnavailableExceptionProxy : Exception { }
}

internal static class WinMmAudio
{
    private const uint WaveMapper = 0xffffffff;
    private const uint WhdrDone = 0x00000001;

    internal static byte[] CapturePcm16Mono(int sampleRate, TimeSpan timeout)
    {
        var format = new WaveFormat { FormatTag = 1, Channels = 1, SamplesPerSec = (uint)sampleRate, AvgBytesPerSec = (uint)(sampleRate * 2), BlockAlign = 2, BitsPerSample = 16, Size = 0 };
        if (waveInOpen(out IntPtr input, WaveMapper, ref format, IntPtr.Zero, IntPtr.Zero, 0) != 0) throw new AudioUnavailableException();
        byte[] buffer = new byte[Math.Min(64 * 1024, sampleRate * 2 * 2)];
        GCHandle pinned = default;
        IntPtr headerPointer = IntPtr.Zero;
        try
        {
            pinned = GCHandle.Alloc(buffer, GCHandleType.Pinned);
            var header = new WaveHeader { Data = pinned.AddrOfPinnedObject(), BufferLength = (uint)buffer.Length };
            headerPointer = Marshal.AllocHGlobal(Marshal.SizeOf<WaveHeader>());
            Marshal.StructureToPtr(header, headerPointer, false);
            if (waveInPrepareHeader(input, headerPointer, (uint)Marshal.SizeOf<WaveHeader>()) != 0 || waveInAddBuffer(input, headerPointer, (uint)Marshal.SizeOf<WaveHeader>()) != 0 || waveInStart(input) != 0)
                throw new AudioUnavailableException();
            DateTime deadline = DateTime.UtcNow + timeout;
            while (DateTime.UtcNow < deadline)
            {
                header = Marshal.PtrToStructure<WaveHeader>(headerPointer);
                if ((header.Flags & WhdrDone) != 0)
                {
                    if (header.BytesRecorded == 0 || header.BytesRecorded > buffer.Length) throw new AudioUnavailableException();
                    return buffer.AsSpan(0, checked((int)header.BytesRecorded)).ToArray();
                }
                Thread.Sleep(10);
            }
            throw new AudioUnavailableException();
        }
        finally
        {
            _ = waveInReset(input);
            if (headerPointer != IntPtr.Zero) { _ = waveInUnprepareHeader(input, headerPointer, (uint)Marshal.SizeOf<WaveHeader>()); Marshal.FreeHGlobal(headerPointer); }
            _ = waveInClose(input);
            if (pinned.IsAllocated) pinned.Free();
            CryptographicOperations.ZeroMemory(buffer);
        }
    }

    internal static bool HasVoiceActivity(ReadOnlySpan<byte> pcm)
    {
        if (pcm.Length < 320 || pcm.Length % 2 != 0) return false;
        long absoluteTotal = 0;
        int peaks = 0;
        for (int index = 0; index < pcm.Length; index += 2)
        {
            short sample = (short)(pcm[index] | (pcm[index + 1] << 8));
            int absolute = Math.Abs((int)sample);
            absoluteTotal += absolute;
            if (absolute >= 700) peaks++;
        }
        int samples = pcm.Length / 2;
        return absoluteTotal / samples >= 120 && peaks >= Math.Max(8, samples / 500);
    }

    [StructLayout(LayoutKind.Sequential)] private struct WaveFormat { public ushort FormatTag; public ushort Channels; public uint SamplesPerSec; public uint AvgBytesPerSec; public ushort BlockAlign; public ushort BitsPerSample; public ushort Size; }
    [StructLayout(LayoutKind.Sequential)] private struct WaveHeader { public IntPtr Data; public uint BufferLength; public uint BytesRecorded; public IntPtr User; public uint Flags; public uint Loops; public IntPtr Next; public IntPtr Reserved; }
    [DllImport("winmm.dll")] private static extern int waveInOpen(out IntPtr input, uint deviceId, ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);
    [DllImport("winmm.dll")] private static extern int waveInPrepareHeader(IntPtr input, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern int waveInAddBuffer(IntPtr input, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern int waveInStart(IntPtr input);
    [DllImport("winmm.dll")] private static extern int waveInReset(IntPtr input);
    [DllImport("winmm.dll")] private static extern int waveInUnprepareHeader(IntPtr input, IntPtr header, uint size);
    [DllImport("winmm.dll")] private static extern int waveInClose(IntPtr input);
    internal sealed class AudioUnavailableException : Exception { }
}

internal static class Dpapi
{
    internal static byte[] Protect(byte[] plaintext, byte[] entropy) => Transform(plaintext, entropy, protect: true);
    internal static byte[] Unprotect(byte[] ciphertext, byte[] entropy) => Transform(ciphertext, entropy, protect: false);

    private static byte[] Transform(byte[] input, byte[] entropy, bool protect)
    {
        DataBlob source = Blob(input);
        DataBlob optionalEntropy = Blob(entropy);
        DataBlob output = default;
        try
        {
            bool ok = protect
                ? CryptProtectData(ref source, null, ref optionalEntropy, IntPtr.Zero, IntPtr.Zero, 0x1, out output)
                : CryptUnprotectData(ref source, IntPtr.Zero, ref optionalEntropy, IntPtr.Zero, IntPtr.Zero, 0x1, out output);
            if (!ok || output.Size <= 0 || output.Data == IntPtr.Zero) throw new CryptographicException(Marshal.GetLastWin32Error());
            byte[] result = new byte[output.Size];
            Marshal.Copy(output.Data, result, 0, output.Size);
            return result;
        }
        finally
        {
            if (source.Data != IntPtr.Zero) { ZeroAndFree(source.Data, source.Size, local: false); }
            if (optionalEntropy.Data != IntPtr.Zero) { ZeroAndFree(optionalEntropy.Data, optionalEntropy.Size, local: false); }
            if (output.Data != IntPtr.Zero) { ZeroAndFree(output.Data, output.Size, local: true); }
        }
    }

    private static DataBlob Blob(byte[] value)
    {
        IntPtr data = Marshal.AllocHGlobal(value.Length);
        Marshal.Copy(value, 0, data, value.Length);
        return new DataBlob { Size = value.Length, Data = data };
    }

    private static void ZeroAndFree(IntPtr data, int size, bool local)
    {
        for (int index = 0; index < size; index++) Marshal.WriteByte(data, index, 0);
        if (local) _ = LocalFree(data); else Marshal.FreeHGlobal(data);
    }

    [StructLayout(LayoutKind.Sequential)] private struct DataBlob { public int Size; public IntPtr Data; }
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CryptProtectData(ref DataBlob input, string? description, ref DataBlob entropy, IntPtr reserved, IntPtr prompt, uint flags, out DataBlob output);
    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, ref DataBlob entropy, IntPtr reserved, IntPtr prompt, uint flags, out DataBlob output);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
}
