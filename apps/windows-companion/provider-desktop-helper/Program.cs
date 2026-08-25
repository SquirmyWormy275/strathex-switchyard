using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Sxsy.B122.ProviderDesktopHelper;

internal static class Program
{
    private const string RequestSchema = "sxsy-b122.provider-desktop-request";
    private const string ResponseSchema = "sxsy-b122.provider-desktop-response";
    private const int MaximumRequestChars = 16 * 1024;
    private const int MaximumSurfaces = 64;
    private const int LaunchSurfaceTimeoutMs = 15_000;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint Synchronize = 0x00100000;
    private const uint GenericRead = 0x80000000;
    private const uint FileReadAttributes = 0x00000080;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileFlagBackupSemantics = 0x02000000;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint CreateNewProcessGroup = 0x00000200;
    private const uint JobObjectExtendedLimitInformationClass = 9;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint WaitTimeout = 0x00000102;
    private const uint WaitFailed = 0xffffffff;
    private const uint Infinite = 0xffffffff;
    private const uint GwOwner = 4;
    private const uint DwmwaCloaked = 14;

    private static readonly IReadOnlyDictionary<string, ProductDefinition> Products =
        new Dictionary<string, ProductDefinition>(StringComparer.Ordinal)
        {
            ["claude_desktop"] = new("anthropic.claude-desktop", "Claude Desktop", "Anthropic, PBC", "Claude Desktop", "Anthropic, PBC"),
            ["chatgpt_desktop"] = new("openai.chatgpt-desktop", "ChatGPT Desktop", "OpenAI, L.L.C.", "ChatGPT Desktop", "OpenAI, L.L.C."),
            ["claude_code"] = new("anthropic.claude-code", "Claude Code", "Anthropic, PBC", "Claude Code", "Anthropic PBC"),
            ["codex"] = new("openai.codex", "Codex", "OpenAI, L.L.C.", "codex-windows-sandbox", "")
        };

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        if (args.Length == 2 && args[0] == "--managed-terminal-v1")
        {
            try
            {
                if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
                return RunManagedTerminal(ParseManagedTerminalDescriptor(args[1]));
            }
            catch (ProtocolException exception)
            {
                Console.Error.WriteLine($"SXSY-B122 managed-terminal launch refused ({exception.Code}).");
                return 65;
            }
            catch
            {
                Console.Error.WriteLine("SXSY-B122 managed-terminal launch failed closed (native_failure).");
                return 70;
            }
        }
        if (args.Length != 1 || args[0] != "--stdio-v1") return 64;
        string requestId = "unknown";
        try
        {
            if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
            string line = ReadBoundedLine(Console.In, MaximumRequestChars);
            Request request = ParseRequest(line);
            requestId = request.RequestId;
            return request.Action switch
            {
                "list" => List(request),
                "focus" => Focus(request),
                "launch" => Launch(request),
                _ => throw new ProtocolException("invalid_action")
            };
        }
        catch (ProtocolException exception)
        {
            Write(new { schema = ResponseSchema, version = 1, requestId, kind = "error", code = exception.Code });
            return 65;
        }
        catch
        {
            Write(new { schema = ResponseSchema, version = 1, requestId, kind = "error", code = "native_failure" });
            return 70;
        }
    }

    private static int SelfTest()
    {
        bool products = Products.Count == 4
            && Products["claude_desktop"].ProductId == "anthropic.claude-desktop"
            && Products["chatgpt_desktop"].ProductId == "openai.chatgpt-desktop"
            && Products["claude_code"].ProductId == "anthropic.claude-code"
            && Products["codex"].ProductId == "openai.codex";
        bool quoting = QuoteArgument("--new-window") == "--new-window"
            && QuoteArgument("C:\\Program Files\\Provider\\Provider.exe") == "\"C:\\Program Files\\Provider\\Provider.exe\"";
        bool surfaces = TryParseSurfaceId("hwnd:1a", out IntPtr handle) && handle == new IntPtr(0x1a)
            && !TryParseSurfaceId("pid:42", out _);
        Write(new { schema = "sxsy-b122.provider-desktop-self-test", version = 1, status = products && quoting && surfaces ? "ok" : "failed" });
        return products && quoting && surfaces ? 0 : 1;
    }

    private static Request ParseManagedTerminalDescriptor(string encoded)
    {
        if (encoded.Length is < 32 or > MaximumRequestChars || encoded.Any(character => !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_')))
            throw new ProtocolException("invalid_managed_terminal_descriptor");
        string padded = encoded.Replace('-', '+').Replace('_', '/');
        padded += (padded.Length % 4) switch { 0 => "", 2 => "==", 3 => "=", _ => throw new ProtocolException("invalid_managed_terminal_descriptor") };
        string json;
        try { json = new UTF8Encoding(false, true).GetString(Convert.FromBase64String(padded)); }
        catch (Exception exception) when (exception is FormatException or DecoderFallbackException)
        { throw new ProtocolException("invalid_managed_terminal_descriptor", exception); }
        if (Encoding.UTF8.GetByteCount(json) > MaximumRequestChars) throw new ProtocolException("invalid_managed_terminal_descriptor");
        using JsonDocument document = ParseJson(json);
        JsonElement root = document.RootElement;
        RequireProperties(root, "schema", "version", "provider", "identity", "workspace", "receipt");
        if (Text(root, "schema") != "sxsy-b122.managed-terminal-launch" || Integer(root, "version") != 1)
            throw new ProtocolException("invalid_managed_terminal_schema");
        string provider = Text(root, "provider");
        if (provider is not ("claude_code" or "codex") || !Products.TryGetValue(provider, out ProductDefinition? product) || product is null)
            throw new ProtocolException("invalid_provider");
        ExecutableIdentity identity = ParseIdentity(Property(root, "identity"), product, "managed_terminal");
        WorkspaceIdentity workspace = ParseWorkspace(Property(root, "workspace"));
        ReceiptDescriptor receipt = ParseReceipt(Property(root, "receipt"));
        return new Request(Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant(), "managed_terminal", provider, identity, null, null, Array.Empty<string>(), false, workspace, receipt);
    }

    private static int RunManagedTerminal(Request request)
    {
        if (request.Action != "managed_terminal" || request.Provider is not ("claude_code" or "codex") || request.Arguments.Length != 0)
            throw new ProtocolException("invalid_managed_terminal_request");
        if (request.Workspace is null || request.Receipt is null) throw new ProtocolException("invalid_managed_terminal_request");
        using HeldExecutable executable = HeldExecutable.Acquire(request);
        using HeldDirectory workspace = HeldDirectory.Acquire(request.Workspace);
        if (!SamePath(Environment.CurrentDirectory, workspace.CanonicalPath)) throw new ProtocolException("managed_terminal_workspace_changed");
        executable.RevalidateLockedHandle();
        workspace.Revalidate();
        using JobGuard job = JobGuard.Create();
        using LaunchedProcess launched = CreateManagedTerminalProcess(request, job);
        WriteManagedTerminalReceipt(request, workspace, launched.ProcessId);
        uint waited = WaitForSingleObject(launched.Process, Infinite);
        if (waited == WaitFailed) throw NativeFailure("managed_terminal_wait_failed");
        if (!GetExitCodeProcess(launched.Process, out uint exitCode)) throw NativeFailure("managed_terminal_exit_unavailable");
        return exitCode > int.MaxValue ? 70 : (int)exitCode;
    }

    private static WorkspaceIdentity ParseWorkspace(JsonElement value)
    {
        RequireProperties(value, "canonicalPath", "device", "inode");
        string path = Text(value, "canonicalPath");
        long device = LongInteger(value, "device");
        long inode = LongInteger(value, "inode");
        if (!Path.IsPathFullyQualified(path) || path.Length > 4096 || path.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0 || device < 0 || inode < 0)
            throw new ProtocolException("invalid_workspace_identity");
        return new(path, device, inode);
    }

    private static ReceiptDescriptor ParseReceipt(JsonElement value)
    {
        RequireProperties(value, "pipeName", "token");
        string pipeName = Text(value, "pipeName");
        string token = Text(value, "token");
        if (pipeName.Length is < 24 or > 96 || !pipeName.StartsWith("sxsy-b122-managed-", StringComparison.Ordinal)
            || !pipeName.All(character => char.IsAsciiLetterOrDigit(character) || character == '-')
            || token.Length != 64 || !token.All(IsLowerHex)) throw new ProtocolException("invalid_receipt_boundary");
        return new(pipeName, token);
    }

    private static void WriteManagedTerminalReceipt(Request request, HeldDirectory workspace, uint processId)
    {
        ReceiptDescriptor receipt = request.Receipt ?? throw new ProtocolException("invalid_receipt_boundary");
        using var pipe = new NamedPipeClientStream(".", receipt.PipeName, PipeDirection.Out, PipeOptions.WriteThrough);
        try { pipe.Connect(5_000); }
        catch (TimeoutException exception) { throw new ProtocolException("receipt_pipe_unavailable", exception); }
        string line = JsonSerializer.Serialize(new
        {
            schema = "sxsy-b122.managed-terminal-started",
            version = 1,
            token = receipt.Token,
            provider = request.Provider,
            processId,
            canonicalExecutablePath = request.Identity.CanonicalExecutablePath,
            canonicalWorkspaceRoot = workspace.CanonicalPath
        });
        if (Encoding.UTF8.GetByteCount(line) > 4_096) throw new ProtocolException("receipt_oversized");
        byte[] bytes = Encoding.UTF8.GetBytes(line + "\n");
        pipe.Write(bytes, 0, bytes.Length);
        pipe.Flush();
    }

    private static LaunchedProcess CreateManagedTerminalProcess(Request request, JobGuard job)
    {
        string executablePath = request.Identity.CanonicalExecutablePath;
        var startup = new StartupInfo { Cb = Marshal.SizeOf<StartupInfo>() };
        if (!CreateProcessW(
            executablePath,
            new StringBuilder(QuoteArgument(executablePath)),
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            CreateSuspended | CreateNewProcessGroup,
            IntPtr.Zero,
            Environment.CurrentDirectory,
            ref startup,
            out ProcessInformation information)) throw NativeFailure("managed_terminal_create_process_failed");
        var process = new SafeFileHandle(information.Process, ownsHandle: true);
        var thread = new SafeFileHandle(information.Thread, ownsHandle: true);
        try
        {
            job.Assign(process);
            if (ResumeThread(thread) == uint.MaxValue) throw NativeFailure("managed_terminal_resume_failed");
            return new LaunchedProcess(process, thread, information.ProcessId);
        }
        catch
        {
            process.Dispose();
            thread.Dispose();
            throw;
        }
    }

    private static int List(Request request)
    {
        using SurfaceSet surfaces = SurfaceSet.Acquire(request);
        Write(new
        {
            schema = ResponseSchema,
            version = 1,
            requestId = request.RequestId,
            kind = "result",
            observations = surfaces.Items.Select(surface => new { processId = surface.ProcessId, surfaceId = surface.SurfaceId }).ToArray()
        });
        return 0;
    }

    private static int Focus(Request request)
    {
        if (request.ExpectedProcessId is null || request.ExpectedSurfaceId is null) throw new ProtocolException("invalid_focus_target");
        using SurfaceSet surfaces = SurfaceSet.Acquire(request);
        if (surfaces.Items.Count != 1) throw new ProtocolException("ambiguous_focus_surface");
        HeldSurface held = surfaces.Items[0];
        if (held.ProcessId != request.ExpectedProcessId.Value || held.SurfaceId != request.ExpectedSurfaceId)
            throw new ProtocolException("changed_focus_surface");

        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        Write(new
        {
            schema = ResponseSchema,
            version = 1,
            requestId = request.RequestId,
            kind = "ready",
            authorizationToken = token,
            processId = held.ProcessId,
            surfaceId = held.SurfaceId
        });
        ReadAuthorization(request.RequestId, token);

        held.RevalidateLockedHandles();
        using SurfaceSet final = SurfaceSet.Acquire(request);
        if (final.Items.Count != 1 || final.Items[0].ProcessId != held.ProcessId || final.Items[0].SurfaceId != held.SurfaceId)
            throw new ProtocolException("changed_focus_surface");
        if (!SetForegroundWindow(held.Window)) throw new ProtocolException("focus_denied");
        Write(new { schema = ResponseSchema, version = 1, requestId = request.RequestId, kind = "result", processId = held.ProcessId, surfaceId = held.SurfaceId });
        return 0;
    }

    private static int Launch(Request request)
    {
        ValidateFixedArguments(request);
        using SurfaceSet before = SurfaceSet.Acquire(request);
        string[] preexisting = before.Items.Select(surface => surface.SurfaceId).Order(StringComparer.Ordinal).ToArray();
        if (!request.RequireDistinctSurface && preexisting.Length != 0) throw new ProtocolException("ambiguous_normal_launch");

        using HeldExecutable executable = HeldExecutable.Acquire(request);
        string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        Write(new
        {
            schema = ResponseSchema,
            version = 1,
            requestId = request.RequestId,
            kind = "ready",
            authorizationToken = token,
            preexistingSurfaceIds = preexisting
        });
        ReadAuthorization(request.RequestId, token);
        executable.RevalidateLockedHandle();
        if (!request.RequireDistinctSurface)
        {
            using SurfaceSet finalBefore = SurfaceSet.Acquire(request);
            if (finalBefore.Items.Count != 0) throw new ProtocolException("ambiguous_normal_launch");
        }

        using JobGuard job = JobGuard.Create();
        using LaunchedProcess launched = CreateProviderProcess(request, job);
        HeldSurface? newSurface = null;
        try
        {
            var deadline = Stopwatch.StartNew();
            while (deadline.ElapsedMilliseconds < LaunchSurfaceTimeoutMs)
            {
                if (WaitForSingleObject(launched.Process, 0) != WaitTimeout) throw new ProtocolException("launch_exited_without_surface");
                using SurfaceSet current = SurfaceSet.Acquire(request);
                HeldSurface? candidate = current.DetachSingleForProcess(launched.ProcessId, preexisting);
                if (candidate is not null)
                {
                    newSurface = candidate;
                    break;
                }
                Thread.Sleep(25);
            }
            if (newSurface is null) throw new ProtocolException("launch_surface_timeout");
            newSurface.Revalidate();
            job.ReleaseSuccessfulProcess();
            Write(new
            {
                schema = ResponseSchema,
                version = 1,
                requestId = request.RequestId,
                kind = "result",
                processId = launched.ProcessId,
                surfaceId = newSurface.SurfaceId,
                distinctSurface = !preexisting.Contains(newSurface.SurfaceId, StringComparer.Ordinal)
            });
            return 0;
        }
        finally
        {
            newSurface?.Dispose();
        }
    }

    private static LaunchedProcess CreateProviderProcess(Request request, JobGuard job)
    {
        string commandLine = string.Join(' ', new[] { QuoteArgument(request.Identity.CanonicalExecutablePath) }.Concat(request.Arguments.Select(QuoteArgument)));
        string environment = BuildSanitizedEnvironment(request.RequireDistinctSurface ? "fresh" : "normal");
        var startup = new StartupInfo { Cb = Marshal.SizeOf<StartupInfo>() };
        IntPtr environmentBlock = Marshal.StringToHGlobalUni(environment);
        ProcessInformation information;
        try
        {
            if (!CreateProcessW(
                request.Identity.CanonicalExecutablePath,
                new StringBuilder(commandLine),
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                CreateSuspended | CreateUnicodeEnvironment | CreateNewProcessGroup,
                environmentBlock,
                Path.GetDirectoryName(request.Identity.CanonicalExecutablePath),
                ref startup,
                out information)) throw NativeFailure("create_process_failed");
        }
        finally { Marshal.FreeHGlobal(environmentBlock); }
        var process = new SafeFileHandle(information.Process, ownsHandle: true);
        var thread = new SafeFileHandle(information.Thread, ownsHandle: true);
        try
        {
            job.Assign(process);
            if (ResumeThread(thread) == uint.MaxValue) throw NativeFailure("resume_process_failed");
            return new LaunchedProcess(process, thread, information.ProcessId);
        }
        catch
        {
            process.Dispose();
            thread.Dispose();
            throw;
        }
    }

    private static string BuildSanitizedEnvironment(string mode)
    {
        var values = new SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot") ?? "C:\\Windows",
            ["WINDIR"] = Environment.GetEnvironmentVariable("WINDIR") ?? Environment.GetEnvironmentVariable("SystemRoot") ?? "C:\\Windows",
            ["USERPROFILE"] = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ["APPDATA"] = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            ["LOCALAPPDATA"] = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            ["TEMP"] = Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar),
            ["TMP"] = Path.GetTempPath().TrimEnd(Path.DirectorySeparatorChar),
            ["SXSY_B122_PROVIDER_MODE"] = mode
        };
        if (values.Values.Any(value => string.IsNullOrWhiteSpace(value) || value.Contains('\0') || value.Contains('\r') || value.Contains('\n')))
            throw new ProtocolException("host_environment_unavailable");
        var builder = new StringBuilder();
        foreach ((string key, string value) in values)
        {
            builder.Append(key).Append('=').Append(value).Append('\0');
        }
        return builder.Append('\0').ToString();
    }

    private static void ReadAuthorization(string requestId, string token)
    {
        string line = ReadBoundedLine(Console.In, MaximumRequestChars);
        using JsonDocument document = ParseJson(line);
        JsonElement root = document.RootElement;
        RequireProperties(root, "schema", "version", "requestId", "kind", "authorizationToken");
        if (Text(root, "schema") != RequestSchema || Integer(root, "version") != 1 || Text(root, "requestId") != requestId
            || Text(root, "kind") != "authorize" || !CryptographicOperations.FixedTimeEquals(
                Encoding.ASCII.GetBytes(Text(root, "authorizationToken")), Encoding.ASCII.GetBytes(token)))
            throw new ProtocolException("authorization_rejected");
    }

    private static Request ParseRequest(string line)
    {
        using JsonDocument document = ParseJson(line);
        JsonElement root = document.RootElement;
        string action = Text(root, "action");
        string[] allowed = action switch
        {
            "list" => new[] { "schema", "version", "requestId", "action", "provider", "identity" },
            "focus" => new[] { "schema", "version", "requestId", "action", "provider", "identity", "expectedProcessId", "expectedSurfaceId" },
            "launch" => new[] { "schema", "version", "requestId", "action", "provider", "identity", "args", "requireDistinctSurface" },
            _ => throw new ProtocolException("invalid_action")
        };
        RequireProperties(root, allowed);
        if (Text(root, "schema") != RequestSchema || Integer(root, "version") != 1) throw new ProtocolException("invalid_schema");
        string requestId = Text(root, "requestId");
        if (requestId.Length != 48 || !requestId.All(IsLowerHex)) throw new ProtocolException("invalid_request_id");
        string provider = Text(root, "provider");
        if (!Products.TryGetValue(provider, out ProductDefinition? product) || product is null) throw new ProtocolException("invalid_provider");
        if (provider is not ("claude_desktop" or "chatgpt_desktop")) throw new ProtocolException("invalid_provider");
        ExecutableIdentity identity = ParseIdentity(Property(root, "identity"), product, "desktop");
        uint? processId = action == "focus" ? UnsignedInteger(root, "expectedProcessId") : null;
        string? surfaceId = action == "focus" ? Text(root, "expectedSurfaceId") : null;
        if (surfaceId is not null && !TryParseSurfaceId(surfaceId, out _)) throw new ProtocolException("invalid_surface_id");
        string[] arguments = action == "launch" ? StringArray(root, "args") : Array.Empty<string>();
        bool distinct = action == "launch" && Boolean(root, "requireDistinctSurface");
        var request = new Request(requestId, action, provider, identity, processId, surfaceId, arguments, distinct);
        if (action == "launch") ValidateFixedArguments(request);
        return request;
    }

    private static ExecutableIdentity ParseIdentity(JsonElement value, ProductDefinition product, string expectedRole)
    {
        RequireProperties(value, "canonicalExecutablePath", "executableSha256", "signerSubject", "signerThumbprint", "productIdentity", "size", "modifiedMs", "device", "inode");
        JsonElement productValue = Property(value, "productIdentity");
        RequireProperties(productValue, "productId", "displayName", "publisher", "role");
        if (Text(productValue, "productId") != product.ProductId || Text(productValue, "displayName") != product.DisplayName
            || Text(productValue, "publisher") != product.Publisher || Text(productValue, "role") != expectedRole)
            throw new ProtocolException("product_identity_mismatch");
        string path = Text(value, "canonicalExecutablePath");
        string hash = Text(value, "executableSha256");
        string signerSubject = Text(value, "signerSubject");
        string signerThumbprint = Text(value, "signerThumbprint");
        long size = LongInteger(value, "size");
        double modifiedMs = Double(value, "modifiedMs");
        long device = LongInteger(value, "device");
        long inode = LongInteger(value, "inode");
        if (!Path.IsPathFullyQualified(path) || !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || path.Length > 4096 || path.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0)
            throw new ProtocolException("invalid_executable_path");
        if (hash.Length != 64 || !hash.All(IsLowerHex) || signerSubject.Length is < 3 or > 512 || signerSubject.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0
            || signerThumbprint.Length is < 40 or > 128 || !signerThumbprint.All(IsLowerHex) || size <= 0 || size > 2L * 1024 * 1024 * 1024
            || !double.IsFinite(modifiedMs) || modifiedMs < 0 || device < 0 || inode < 0)
            throw new ProtocolException("invalid_executable_identity");
        return new(path, hash, product, signerSubject, signerThumbprint, size, modifiedMs, device, inode);
    }

    private static void ValidateFixedArguments(Request request)
    {
        string[] expected = request.RequireDistinctSurface ? new[] { "--new-window" } : Array.Empty<string>();
        if (!request.Arguments.SequenceEqual(expected, StringComparer.Ordinal)) throw new ProtocolException("unreviewed_launch_arguments");
    }

    private static JsonDocument ParseJson(string line)
    {
        try
        {
            return JsonDocument.Parse(line, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 12 });
        }
        catch (JsonException)
        {
            throw new ProtocolException("invalid_json");
        }
    }

    private static void RequireProperties(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new ProtocolException("invalid_object");
        var expected = new HashSet<string>(names, StringComparer.Ordinal);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!expected.Contains(property.Name) || !seen.Add(property.Name)) throw new ProtocolException("unexpected_property");
        }
        if (!expected.SetEquals(seen)) throw new ProtocolException("missing_property");
    }

    private static JsonElement Property(JsonElement value, string name) => value.TryGetProperty(name, out JsonElement property)
        ? property : throw new ProtocolException("missing_property");
    private static string Text(JsonElement value, string name) => Property(value, name).ValueKind == JsonValueKind.String
        ? Property(value, name).GetString() ?? throw new ProtocolException("invalid_string") : throw new ProtocolException("invalid_string");
    private static int Integer(JsonElement value, string name) => Property(value, name).TryGetInt32(out int number)
        ? number : throw new ProtocolException("invalid_integer");
    private static uint UnsignedInteger(JsonElement value, string name) => Property(value, name).TryGetUInt32(out uint number) && number > 0
        ? number : throw new ProtocolException("invalid_process_id");
    private static long LongInteger(JsonElement value, string name) => Property(value, name).TryGetInt64(out long number)
        ? number : throw new ProtocolException("invalid_integer");
    private static double Double(JsonElement value, string name) => Property(value, name).TryGetDouble(out double number)
        ? number : throw new ProtocolException("invalid_number");
    private static bool Boolean(JsonElement value, string name) => Property(value, name).ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => throw new ProtocolException("invalid_boolean")
    };
    private static string[] StringArray(JsonElement value, string name)
    {
        JsonElement array = Property(value, name);
        if (array.ValueKind != JsonValueKind.Array || array.GetArrayLength() > 4) throw new ProtocolException("invalid_arguments");
        return array.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String && item.GetString() is string text && text.Length <= 128 && text.IndexOfAny(new[] { '\0', '\r', '\n' }) < 0
            ? text : throw new ProtocolException("invalid_arguments")).ToArray();
    }

    private static string ReadBoundedLine(TextReader reader, int maximumChars)
    {
        var builder = new StringBuilder(Math.Min(maximumChars, 4096));
        while (true)
        {
            int next = reader.Read();
            if (next < 0) throw new ProtocolException("protocol_closed");
            char character = (char)next;
            if (character == '\n') return builder.ToString().TrimEnd('\r');
            if (builder.Length >= maximumChars) throw new ProtocolException("request_oversized");
            builder.Append(character);
        }
    }

    private static void Write(object value)
    {
        string line = JsonSerializer.Serialize(value);
        if (Encoding.UTF8.GetByteCount(line) > 64 * 1024) throw new ProtocolException("response_oversized");
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    private static string QuoteArgument(string value)
    {
        if (value.Length > 4096 || value.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0) throw new ProtocolException("invalid_launch_argument");
        if (value.Length > 0 && value.All(character => !char.IsWhiteSpace(character) && character != '"')) return value;
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') result.Append('\\', slashes * 2 + 1).Append('"');
            else { result.Append('\\', slashes).Append(character); }
            slashes = 0;
        }
        return result.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static bool IsLowerHex(char value) => value is >= '0' and <= '9' or >= 'a' and <= 'f';
    private static string NormalizePath(string value) => value.StartsWith("\\\\?\\", StringComparison.Ordinal) ? value[4..] : value;
    private static bool SamePath(string left, string right) => string.Equals(Path.GetFullPath(NormalizePath(left)).TrimEnd('\\'), Path.GetFullPath(NormalizePath(right)).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    private static string SurfaceId(IntPtr window) => $"hwnd:{window.ToInt64():x}";
    private static bool TryParseSurfaceId(string value, out IntPtr window)
    {
        window = IntPtr.Zero;
        if (!value.StartsWith("hwnd:", StringComparison.Ordinal) || value.Length is < 6 or > 21) return false;
        if (!long.TryParse(value.AsSpan(5), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture, out long parsed) || parsed <= 0) return false;
        window = new IntPtr(parsed);
        return true;
    }
    private static ProtocolException NativeFailure(string code) => new(code, new Win32Exception(Marshal.GetLastWin32Error()));

    private sealed record ProductDefinition(string ProductId, string DisplayName, string Publisher, string NativeProductName, string NativeCompanyName);
    private sealed record ExecutableIdentity(string CanonicalExecutablePath, string ExecutableSha256, ProductDefinition Product, string SignerSubject, string SignerThumbprint, long Size, double ModifiedMs, long Device, long Inode);
    private sealed record WorkspaceIdentity(string CanonicalPath, long Device, long Inode);
    private sealed record ReceiptDescriptor(string PipeName, string Token);
    private sealed record Request(string RequestId, string Action, string Provider, ExecutableIdentity Identity, uint? ExpectedProcessId, string? ExpectedSurfaceId, string[] Arguments, bool RequireDistinctSurface, WorkspaceIdentity? Workspace = null, ReceiptDescriptor? Receipt = null);

    private sealed class ProtocolException : Exception
    {
        public string Code { get; }
        public ProtocolException(string code, Exception? inner = null) : base(code, inner) => Code = code;
    }

    private sealed class HeldExecutable : IDisposable
    {
        private readonly Request _request;
        private readonly SafeFileHandle _file;
        private readonly string _canonicalPath;

        private HeldExecutable(Request request, SafeFileHandle file, string canonicalPath)
        {
            _request = request;
            _file = file;
            _canonicalPath = canonicalPath;
        }

        public static HeldExecutable Acquire(Request request)
        {
            SafeFileHandle file = CreateFileW(request.Identity.CanonicalExecutablePath, GenericRead, FileShareRead, IntPtr.Zero, OpenExisting, 0, IntPtr.Zero);
            if (file.IsInvalid) throw NativeFailure("executable_lock_failed");
            try
            {
                string canonical = FinalPath(file);
                var held = new HeldExecutable(request, file, canonical);
                held.Revalidate();
                return held;
            }
            catch
            {
                file.Dispose();
                throw;
            }
        }

        public void Revalidate()
        {
            RevalidateLockedHandle();
            using var stream = new FileStream(_canonicalPath, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.SequentialScan);
            string hash = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
            if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(hash), Encoding.ASCII.GetBytes(_request.Identity.ExecutableSha256)))
                throw new ProtocolException("executable_digest_changed");
            FileVersionInfo version = FileVersionInfo.GetVersionInfo(_canonicalPath);
            if (!string.Equals(version.ProductName ?? "", _request.Identity.Product.NativeProductName, StringComparison.Ordinal)
                || !string.Equals(version.CompanyName ?? "", _request.Identity.Product.NativeCompanyName, StringComparison.Ordinal))
                throw new ProtocolException("product_identity_mismatch");
            X509Certificate2 signer;
            try { signer = new X509Certificate2(X509Certificate.CreateFromSignedFile(_canonicalPath)); }
            catch (CryptographicException exception) { throw new ProtocolException("authenticode_signer_unavailable", exception); }
            using (signer)
            {
                string thumbprint = (signer.Thumbprint ?? "").Replace(" ", "", StringComparison.Ordinal).ToLowerInvariant();
                if (!string.Equals(signer.Subject, _request.Identity.SignerSubject, StringComparison.Ordinal)
                    || !string.Equals(thumbprint, _request.Identity.SignerThumbprint, StringComparison.Ordinal))
                    throw new ProtocolException("authenticode_signer_mismatch");
            }
        }

        public void RevalidateLockedHandle()
        {
            if (_file.IsInvalid || _file.IsClosed || !SamePath(_canonicalPath, _request.Identity.CanonicalExecutablePath)) throw new ProtocolException("executable_identity_changed");
            if (!GetFileInformationByHandle(_file, out ByHandleFileInformation information)) throw NativeFailure("executable_identity_unavailable");
            long fileIndex = checked((long)(((ulong)information.FileIndexHigh << 32) | information.FileIndexLow));
            if (information.FileSize != _request.Identity.Size || information.VolumeSerialNumber != (ulong)_request.Identity.Device || fileIndex != _request.Identity.Inode)
                throw new ProtocolException("executable_identity_changed");
            double modifiedMs = DateTimeOffset.FromFileTime(information.LastWriteTime).ToUnixTimeMilliseconds();
            if (Math.Abs(modifiedMs - _request.Identity.ModifiedMs) > 1.0) throw new ProtocolException("executable_identity_changed");
        }

        public void Dispose() => _file.Dispose();
    }

    private sealed class HeldDirectory : IDisposable
    {
        private readonly WorkspaceIdentity _identity;
        private readonly SafeFileHandle _directory;
        public string CanonicalPath { get; }

        private HeldDirectory(WorkspaceIdentity identity, SafeFileHandle directory, string canonicalPath)
        { _identity = identity; _directory = directory; CanonicalPath = canonicalPath; }

        public static HeldDirectory Acquire(WorkspaceIdentity identity)
        {
            SafeFileHandle directory = CreateFileW(identity.CanonicalPath, FileReadAttributes, FileShareRead | FileShareWrite, IntPtr.Zero, OpenExisting, FileFlagBackupSemantics, IntPtr.Zero);
            if (directory.IsInvalid) throw NativeFailure("workspace_lock_failed");
            try
            {
                string canonical = FinalPath(directory);
                var held = new HeldDirectory(identity, directory, canonical);
                held.Revalidate();
                return held;
            }
            catch
            {
                directory.Dispose();
                throw;
            }
        }

        public void Revalidate()
        {
            if (_directory.IsInvalid || _directory.IsClosed || !SamePath(CanonicalPath, _identity.CanonicalPath)) throw new ProtocolException("managed_terminal_workspace_changed");
            if (!GetFileInformationByHandle(_directory, out ByHandleFileInformation information)) throw NativeFailure("workspace_identity_unavailable");
            long fileIndex = checked((long)(((ulong)information.FileIndexHigh << 32) | information.FileIndexLow));
            if (information.VolumeSerialNumber != (ulong)_identity.Device || fileIndex != _identity.Inode) throw new ProtocolException("managed_terminal_workspace_changed");
        }

        public void Dispose() => _directory.Dispose();
    }

    private sealed class HeldSurface : IDisposable
    {
        private readonly Request _request;
        private readonly SafeFileHandle _process;
        private readonly HeldExecutable _executable;
        public uint ProcessId { get; }
        public IntPtr Window { get; }
        public string SurfaceId => Program.SurfaceId(Window);

        private HeldSurface(Request request, SafeFileHandle process, HeldExecutable executable, uint processId, IntPtr window)
        {
            _request = request;
            _process = process;
            _executable = executable;
            ProcessId = processId;
            Window = window;
        }

        public static HeldSurface? TryAcquire(Request request, uint processId, IntPtr window)
        {
            SafeFileHandle process = OpenProcess(ProcessQueryLimitedInformation | Synchronize, false, processId);
            if (process.IsInvalid) { process.Dispose(); return null; }
            HeldExecutable? executable = null;
            try
            {
                string image = ProcessImagePath(process);
                if (!SamePath(image, request.Identity.CanonicalExecutablePath)) { process.Dispose(); return null; }
                executable = HeldExecutable.Acquire(request);
                var held = new HeldSurface(request, process, executable, processId, window);
                held.Revalidate();
                return held;
            }
            catch (ProtocolException)
            {
                executable?.Dispose();
                process.Dispose();
                throw;
            }
            catch
            {
                executable?.Dispose();
                process.Dispose();
                return null;
            }
        }

        public void Revalidate()
        {
            if (_process.IsClosed || _process.IsInvalid || WaitForSingleObject(_process, 0) != WaitTimeout) throw new ProtocolException("provider_process_changed");
            if (!SamePath(ProcessImagePath(_process), _request.Identity.CanonicalExecutablePath)) throw new ProtocolException("provider_process_changed");
            if (!IsWindow(Window) || !IsWindowVisible(Window) || GetWindow(Window, GwOwner) != IntPtr.Zero) throw new ProtocolException("provider_surface_changed");
            GetWindowThreadProcessId(Window, out uint currentProcessId);
            if (currentProcessId != ProcessId) throw new ProtocolException("provider_surface_changed");
            _executable.Revalidate();
        }

        public void RevalidateLockedHandles()
        {
            if (_process.IsClosed || _process.IsInvalid || WaitForSingleObject(_process, 0) != WaitTimeout) throw new ProtocolException("provider_process_changed");
            if (!SamePath(ProcessImagePath(_process), _request.Identity.CanonicalExecutablePath)) throw new ProtocolException("provider_process_changed");
            if (!SafeWindow(Window)) throw new ProtocolException("provider_surface_changed");
            GetWindowThreadProcessId(Window, out uint currentProcessId);
            if (currentProcessId != ProcessId) throw new ProtocolException("provider_surface_changed");
            _executable.RevalidateLockedHandle();
        }

        public void Dispose()
        {
            _executable.Dispose();
            _process.Dispose();
        }
    }

    private sealed class SurfaceSet : IDisposable
    {
        public List<HeldSurface> Items { get; }
        private SurfaceSet(List<HeldSurface> items) => Items = items;

        public static SurfaceSet Acquire(Request request)
        {
            var candidates = new List<(uint ProcessId, IntPtr Window)>();
            if (!EnumWindows((window, _) =>
            {
                if (!SafeWindow(window)) return true;
                GetWindowThreadProcessId(window, out uint processId);
                if (processId > 0) candidates.Add((processId, window));
                return candidates.Count <= MaximumSurfaces * 16;
            }, IntPtr.Zero)) throw NativeFailure("window_enumeration_failed");
            if (candidates.Count > MaximumSurfaces * 16) throw new ProtocolException("window_enumeration_oversized");
            var held = new List<HeldSurface>();
            try
            {
                foreach ((uint processId, IntPtr window) in candidates)
                {
                    HeldSurface? surface = HeldSurface.TryAcquire(request, processId, window);
                    if (surface is null) continue;
                    held.Add(surface);
                    if (held.Count > MaximumSurfaces) throw new ProtocolException("provider_surface_set_oversized");
                }
                held.Sort((left, right) => string.CompareOrdinal(left.SurfaceId, right.SurfaceId));
                return new SurfaceSet(held);
            }
            catch
            {
                foreach (HeldSurface surface in held) surface.Dispose();
                throw;
            }
        }

        public HeldSurface? DetachSingleForProcess(uint processId, IReadOnlyCollection<string> preexisting)
        {
            List<HeldSurface> candidates = Items.Where(surface => surface.ProcessId == processId && !preexisting.Contains(surface.SurfaceId)).ToList();
            if (candidates.Count > 1) throw new ProtocolException("ambiguous_launched_surface");
            if (candidates.Count == 0) return null;
            HeldSurface selected = candidates[0];
            Items.Remove(selected);
            return selected;
        }

        public void Dispose()
        {
            foreach (HeldSurface surface in Items) surface.Dispose();
            Items.Clear();
        }
    }

    private sealed class JobGuard : IDisposable
    {
        private readonly SafeFileHandle _job;
        private bool _released;
        private JobGuard(SafeFileHandle job) => _job = job;

        public static JobGuard Create()
        {
            SafeFileHandle job = CreateJobObjectW(IntPtr.Zero, null);
            if (job.IsInvalid) throw NativeFailure("job_creation_failed");
            try
            {
                SetKillOnClose(job, true);
                return new JobGuard(job);
            }
            catch
            {
                job.Dispose();
                throw;
            }
        }

        public void Assign(SafeFileHandle process)
        {
            if (!AssignProcessToJobObject(_job, process)) throw NativeFailure("job_assignment_failed");
        }

        public void ReleaseSuccessfulProcess()
        {
            SetKillOnClose(_job, false);
            _released = true;
        }

        public void Dispose()
        {
            if (!_released && !_job.IsInvalid && !_job.IsClosed) TerminateJobObject(_job, 125);
            _job.Dispose();
        }

        private static void SetKillOnClose(SafeFileHandle job, bool enabled)
        {
            var information = new JobObjectExtendedLimitInformation();
            information.BasicLimitInformation.LimitFlags = enabled ? JobObjectLimitKillOnJobClose : 0;
            int length = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
            IntPtr buffer = Marshal.AllocHGlobal(length);
            try
            {
                Marshal.StructureToPtr(information, buffer, false);
                if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, buffer, (uint)length)) throw NativeFailure("job_policy_failed");
            }
            finally { Marshal.FreeHGlobal(buffer); }
        }
    }

    private sealed class LaunchedProcess : IDisposable
    {
        public SafeFileHandle Process { get; }
        private readonly SafeFileHandle _thread;
        public uint ProcessId { get; }
        public LaunchedProcess(SafeFileHandle process, SafeFileHandle thread, uint processId) { Process = process; _thread = thread; ProcessId = processId; }
        public void Dispose() { _thread.Dispose(); Process.Dispose(); }
    }

    private static string ProcessImagePath(SafeFileHandle process)
    {
        var builder = new StringBuilder(4096);
        uint size = (uint)builder.Capacity;
        if (!QueryFullProcessImageNameW(process, 0, builder, ref size) || size == 0) throw NativeFailure("process_identity_unavailable");
        return builder.ToString();
    }

    private static bool SafeWindow(IntPtr window)
    {
        if (!IsWindow(window) || !IsWindowVisible(window) || GetWindow(window, GwOwner) != IntPtr.Zero) return false;
        if (DwmGetWindowAttribute(window, DwmwaCloaked, out uint cloaked, sizeof(uint)) != 0 || cloaked != 0) return false;
        if (!GetWindowRect(window, out Rect bounds)) return false;
        return bounds.Right > bounds.Left && bounds.Bottom > bounds.Top;
    }

    private static string FinalPath(SafeFileHandle file)
    {
        var builder = new StringBuilder(4096);
        uint length = GetFinalPathNameByHandleW(file, builder, (uint)builder.Capacity, 0);
        if (length == 0 || length >= builder.Capacity) throw NativeFailure("executable_identity_unavailable");
        return NormalizePath(builder.ToString());
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int Cb;
        public string? Reserved;
        public string? Desktop;
        public string? Title;
        public int X;
        public int Y;
        public int XSize;
        public int YSize;
        public int XCountChars;
        public int YCountChars;
        public int FillAttribute;
        public int Flags;
        public short ShowWindow;
        public short Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StandardInput;
        public IntPtr StandardOutput;
        public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation { public IntPtr Process; public IntPtr Thread; public uint ProcessId; public uint ThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FileTimeNative { public uint Low; public uint High; public long ToLong() => unchecked((long)(((ulong)High << 32) | Low)); public static implicit operator long(FileTimeNative value) => value.ToLong(); }
    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public FileTimeNative CreationTime;
        public FileTimeNative LastAccessTime;
        public FileTimeNative LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
        public long FileSize => checked((long)(((ulong)FileSizeHigh << 32) | FileSizeLow));
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicLimitInformation
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectExtendedLimitInformation
    {
        public JobObjectBasicLimitInformation BasicLimitInformation;
        public IoCounters IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetWindowRect(IntPtr window, out Rect bounds);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryFullProcessImageNameW(SafeFileHandle process, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string path, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out ByHandleFileInformation information);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string? currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeFileHandle job, uint informationClass, IntPtr information, uint informationLength);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(SafeFileHandle job, SafeFileHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(SafeFileHandle job, uint exitCode);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(IntPtr window, uint attribute, out uint value, int size);
}
