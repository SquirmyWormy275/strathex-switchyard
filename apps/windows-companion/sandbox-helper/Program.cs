using System;
using System.Buffers;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace Sxsy.B122.SandboxHelper;

internal static class Program
{
    private const string InputRoot = @"C:\B122\input";
    private const string ExchangeRoot = @"C:\B122\exchange";
    private const string RequestPath = @"C:\B122\exchange\request.json";
    private const string RequestSchema = "sxsy-b122.windows-sandbox-request";
    private const string CatalogSchema = "sxsy-b122.windows-sandbox-catalog";
    private const string ResultSchema = "sxsy-b122.windows-sandbox-result";
    private const int MaximumCatalogBytes = 256 * 1024;
    private const int MaximumRequestBytes = 32 * 1024;
    private const int MaximumRecipes = 32;
    private const int MaximumArguments = 128;
    private const int MaximumEnvironmentEntries = 64;
    private const int MaximumArtifacts = 128;
    private const int MaximumArgumentBytes = 4096;
    private const int MaximumEnvironmentValueBytes = 8192;
    private const int MaximumOutputBytes = 1024 * 1024;
    private const long MaximumSingleArtifactBytes = 64L * 1024 * 1024;
    private const long MaximumArtifactBytes = 64L * 1024 * 1024;
    private const int MaximumTimeoutMilliseconds = 24 * 60 * 60 * 1000;

    private static readonly Regex SafeIdentifier = new(
        "^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SafeRequestId = new(
        "^sandbox-request:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SafeLeaseId = new(
        "^sandbox:[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex ForbiddenEnvironmentName = new(
        "(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DSN)(?:$|_)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SecretMaterial = new(
        "(?:bearer\\s+[a-z0-9._~+/-]{8,}|-----BEGIN[ A-Z]+PRIVATE KEY-----|(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential)\\s*[:=]\\s*\\S+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    private static readonly CancellationTokenSource ApplicationCancellation = new();

    public static async Task<int> Main(string[] args)
    {
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            ApplicationCancellation.Cancel();
        };

        try
        {
            Invocation invocation = ParseInvocation(args);
            await ExecuteAsync(invocation, ApplicationCancellation.Token).ConfigureAwait(false);
            return 0;
        }
        catch (OperationCanceledException)
        {
            WriteDiagnostic("Sandbox helper was cancelled.");
            return 130;
        }
        catch (HelperException exception)
        {
            WriteDiagnostic(exception.Message);
            return exception.ExitCode;
        }
        catch (Exception)
        {
            WriteDiagnostic("Sandbox helper failed closed.");
            return 70;
        }
    }

    private static Invocation ParseInvocation(string[] args)
    {
        if (args.Length != 6 ||
            !StringComparer.Ordinal.Equals(args[0], "--catalog") ||
            !StringComparer.Ordinal.Equals(args[2], "--request") ||
            !StringComparer.Ordinal.Equals(args[4], "--output"))
        {
            throw new HelperException(64, "Expected only --catalog, --request, and --output in the fixed order.");
        }

        string catalogPath = RequireAbsolutePath(args[1], "catalog");
        string requestPath = RequireAbsolutePath(args[3], "request");
        string outputPath = RequireAbsolutePath(args[5], "output");
        if (!IsInside(InputRoot, catalogPath) || SamePath(InputRoot, catalogPath))
        {
            throw new HelperException(64, "Catalog must be a file below the fixed read-only input root.");
        }
        if (!SamePath(RequestPath, requestPath) || !SamePath(ExchangeRoot, outputPath))
        {
            throw new HelperException(64, "Request and output must use the fixed exchange mapping.");
        }
        return new Invocation(catalogPath, requestPath, outputPath);
    }

    private static async Task ExecuteAsync(Invocation invocation, CancellationToken cancellationToken)
    {
        EnsureConcreteDirectory(InputRoot, "input root");
        EnsureConcreteDirectory(invocation.OutputPath, "exchange root");
        EnsureConcreteFile(invocation.CatalogPath, "catalog");
        EnsureConcreteFile(invocation.RequestPath, "request");
        EnsureNoReparseComponents(InputRoot, invocation.CatalogPath);
        EnsureNoReparseComponents(ExchangeRoot, invocation.RequestPath);

        byte[] catalogBytes = ReadBoundedFile(invocation.CatalogPath, MaximumCatalogBytes, "catalog");
        byte[] requestBytes = ReadBoundedFile(invocation.RequestPath, MaximumRequestBytes, "request");
        Request request = ParseRequest(requestBytes);
        string catalogDigest = Sha256Hex(catalogBytes);
        if (!FixedTimeHexEquals(catalogDigest, request.RecipeCatalogDigest))
        {
            throw new HelperException(65, "Catalog digest does not match the exact host request.");
        }

        string executablePath = ResolveCurrentExecutable();
        EnsureConcreteFile(executablePath, "helper executable");
        string helperDigest = Sha256Hex(ReadBoundedFile(executablePath, 256 * 1024 * 1024, "helper executable"));
        if (!FixedTimeHexEquals(helperDigest, request.HelperDigest))
        {
            throw new HelperException(65, "Helper digest does not match the exact host request.");
        }

        Catalog catalog = ParseCatalog(catalogBytes);
        Recipe recipe = catalog.Recipes.SingleOrDefault(item => StringComparer.Ordinal.Equals(item.Id, request.RecipeId))
            ?? throw new HelperException(65, "Requested recipe is absent from the verified catalog.");

        string resultManifestPath = Path.Combine(invocation.OutputPath, "result-manifest.json");
        string resultTemporaryPath = Path.Combine(invocation.OutputPath, ".result-manifest.json.tmp");
        string quarantineOutput = Path.Combine(invocation.OutputPath, "output");
        string workRoot = Path.Combine(invocation.OutputPath, "work");
        if (File.Exists(resultManifestPath) || File.Exists(resultTemporaryPath) || Directory.Exists(quarantineOutput) || Directory.Exists(workRoot))
        {
            throw new HelperException(73, "Exchange output is not empty for this exact request.");
        }

        Directory.CreateDirectory(quarantineOutput);
        Directory.CreateDirectory(workRoot);
        EnsureConcreteDirectory(quarantineOutput, "quarantine output");
        EnsureConcreteDirectory(workRoot, "work root");
        string tempRoot = Path.Combine(workRoot, ".tmp");
        Directory.CreateDirectory(tempRoot);
        EnsureConcreteDirectory(tempRoot, "temporary root");

        ExecutableIdentity executableIdentity = CaptureExecutableIdentity(recipe.Executable);
        string workingRoot = recipe.WorkingRoot == "input" ? InputRoot : workRoot;
        string workingDirectory = ResolveOwnedRelativePath(workingRoot, recipe.WorkingDirectory, mustExist: true, "working directory");
        EnsureConcreteDirectory(workingDirectory, "working directory");
        EnsureNoReparseComponents(workingRoot, workingDirectory);

        Dictionary<string, string> tokens = new(StringComparer.Ordinal)
        {
            ["{INPUT_ROOT}"] = InputRoot,
            ["{EXCHANGE_ROOT}"] = invocation.OutputPath,
            ["{WORK_ROOT}"] = workRoot,
            ["{OUTPUT_ROOT}"] = quarantineOutput
        };
        string[] processArguments = recipe.Arguments.Select(value => ExpandTokens(value, tokens, "argument")).ToArray();
        Dictionary<string, string> processEnvironment = CreateCompleteEnvironment(recipe.Environment, tokens, tempRoot);

        cancellationToken.ThrowIfCancellationRequested();
        AssertExecutableUnchanged(executableIdentity, recipe.ExecutableSha256);
        ProcessExecution processExecution = await RunProcessAsync(
            executableIdentity.CanonicalPath,
            processArguments,
            workingDirectory,
            processEnvironment,
            recipe.TimeoutMilliseconds,
            recipe.MaxOutputBytes,
            cancellationToken).ConfigureAwait(false);

        if (processExecution.ExitCode != 0)
        {
            throw new HelperException(74, "Verified sandbox recipe returned a non-success exit code.");
        }

        var outputs = new List<ResultOutput>();
        AddBoundedProcessOutput(quarantineOutput, "process.stdout.txt", processExecution.StandardOutput, outputs);
        AddBoundedProcessOutput(quarantineOutput, "process.stderr.txt", processExecution.StandardError, outputs);
        CollectArtifacts(recipe.Artifacts, workRoot, quarantineOutput, outputs);

        var manifest = new
        {
            schema = ResultSchema,
            version = 1,
            requestId = request.RequestId,
            leaseId = request.LeaseId,
            recipeId = request.RecipeId,
            recipeCatalogDigest = request.RecipeCatalogDigest,
            outcome = "completed",
            summary = "Fixed digest-pinned sandbox recipe completed with validated bounded outputs.",
            outputs = outputs.Select(output => new { path = output.Path, size = output.Size, sha256 = output.Sha256 }).ToArray()
        };
        byte[] manifestBytes = JsonSerializer.SerializeToUtf8Bytes(manifest, JsonOptions);
        if (manifestBytes.Length > 256 * 1024)
        {
            throw new HelperException(74, "Result manifest exceeded its fixed bound.");
        }
        AtomicWrite(resultTemporaryPath, resultManifestPath, manifestBytes);
    }

    private static async Task<ProcessExecution> RunProcessAsync(
        string executable,
        IReadOnlyList<string> arguments,
        string workingDirectory,
        IReadOnlyDictionary<string, string> environment,
        int timeoutMilliseconds,
        int maximumOutputBytes,
        CancellationToken cancellationToken)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = executable,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            },
            EnableRaisingEvents = true
        };
        foreach (string argument in arguments)
        {
            process.StartInfo.ArgumentList.Add(argument);
        }
        process.StartInfo.Environment.Clear();
        foreach ((string name, string value) in environment)
        {
            process.StartInfo.Environment.Add(name, value);
        }

        if (!process.Start())
        {
            throw new HelperException(74, "Verified sandbox process did not start.");
        }
        process.StandardInput.Close();
        var budget = new SharedOutputBudget(maximumOutputBytes);
        Task<string> stdout = DrainBoundedAsync(process.StandardOutput, budget);
        Task<string> stderr = DrainBoundedAsync(process.StandardError, budget);
        using var timeout = new CancellationTokenSource(timeoutMilliseconds);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            await process.WaitForExitAsync(linked.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            try
            {
                process.Kill(entireProcessTree: true);
                await process.WaitForExitAsync(CancellationToken.None).ConfigureAwait(false);
            }
            catch (InvalidOperationException)
            {
                // The owned process exited between cancellation and termination.
            }
            await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
            if (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            throw new HelperException(75, "Verified sandbox recipe exceeded its bounded timeout.");
        }
        string[] captured = await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
        return new ProcessExecution(process.ExitCode, captured[0], captured[1]);
    }

    private static async Task<string> DrainBoundedAsync(StreamReader reader, SharedOutputBudget budget)
    {
        char[] buffer = ArrayPool<char>.Shared.Rent(4096);
        using var captured = new MemoryStream();
        try
        {
            while (true)
            {
                int count = await reader.ReadAsync(buffer.AsMemory(0, buffer.Length)).ConfigureAwait(false);
                if (count == 0)
                {
                    break;
                }
                byte[] encoded = Encoding.UTF8.GetBytes(buffer, 0, count);
                int accepted = budget.Take(encoded.Length);
                if (accepted > 0)
                {
                    captured.Write(encoded, 0, accepted);
                }
            }
            return Encoding.UTF8.GetString(captured.ToArray());
        }
        finally
        {
            ArrayPool<char>.Shared.Return(buffer, clearArray: true);
        }
    }

    private static Dictionary<string, string> CreateCompleteEnvironment(
        IReadOnlyDictionary<string, string> declared,
        IReadOnlyDictionary<string, string> tokens,
        string tempRoot)
    {
        var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["SystemRoot"] = @"C:\Windows",
            ["WINDIR"] = @"C:\Windows",
            ["TEMP"] = tempRoot,
            ["TMP"] = tempRoot
        };
        foreach ((string name, string rawValue) in declared)
        {
            if (environment.ContainsKey(name))
            {
                throw new HelperException(65, "Catalog cannot override a fixed guest environment entry.");
            }
            environment.Add(name, ExpandTokens(rawValue, tokens, "environment value"));
        }
        return environment;
    }

    private static void AddBoundedProcessOutput(string outputRoot, string filename, string contents, ICollection<ResultOutput> outputs)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(contents);
        string path = Path.Combine(outputRoot, filename);
        WriteNewFile(path, bytes);
        outputs.Add(new ResultOutput(filename, bytes.LongLength, Sha256Hex(bytes)));
    }

    private static void CollectArtifacts(
        IReadOnlyList<string> artifacts,
        string workRoot,
        string outputRoot,
        ICollection<ResultOutput> outputs)
    {
        long total = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (string relativeArtifact in artifacts)
        {
            if (!seen.Add(relativeArtifact))
            {
                throw new HelperException(74, "Recipe produced duplicate artifact declarations.");
            }
            string source = ResolveOwnedRelativePath(workRoot, relativeArtifact, mustExist: true, "artifact");
            EnsureConcreteFile(source, "artifact");
            EnsureNoReparseComponents(workRoot, source);
            var metadata = new FileInfo(source);
            if (metadata.Length < 0 || metadata.Length > MaximumSingleArtifactBytes || checked(total + metadata.Length) > MaximumArtifactBytes)
            {
                throw new HelperException(74, "Recipe artifact output exceeded its fixed bound.");
            }
            total += metadata.Length;
            byte[] bytes = ReadBoundedFile(source, checked((int)Math.Min(MaximumSingleArtifactBytes, int.MaxValue)), "artifact");
            string destinationRelative = "artifacts/" + relativeArtifact.Replace('\\', '/');
            string destination = ResolveOwnedRelativePath(outputRoot, destinationRelative, mustExist: false, "artifact destination");
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            WriteNewFile(destination, bytes);
            outputs.Add(new ResultOutput(destinationRelative, bytes.LongLength, Sha256Hex(bytes)));
        }
    }

    private static Request ParseRequest(byte[] bytes)
    {
        using JsonDocument document = ParseJson(bytes, "request");
        JsonElement root = RequireExactObject(document.RootElement,
            new[] { "schema", "version", "requestId", "leaseId", "recipeId", "recipeCatalogDigest", "helperDigest" },
            "request");
        RequireExactString(root, "schema", RequestSchema);
        RequireExactInteger(root, "version", 1);
        string requestId = RequireBoundedString(root, "requestId", 256);
        string leaseId = RequireBoundedString(root, "leaseId", 256);
        string recipeId = RequireBoundedString(root, "recipeId", 128);
        string catalogDigest = RequireDigest(root, "recipeCatalogDigest");
        string helperDigest = RequireDigest(root, "helperDigest");
        if (!SafeRequestId.IsMatch(requestId) || !SafeLeaseId.IsMatch(leaseId) || !SafeIdentifier.IsMatch(recipeId))
        {
            throw new HelperException(65, "Request contains an invalid exact identity.");
        }
        return new Request(requestId, leaseId, recipeId, catalogDigest, helperDigest);
    }

    private static Catalog ParseCatalog(byte[] bytes)
    {
        using JsonDocument document = ParseJson(bytes, "catalog");
        JsonElement root = RequireExactObject(document.RootElement, new[] { "schema", "version", "recipes" }, "catalog");
        RequireExactString(root, "schema", CatalogSchema);
        RequireExactInteger(root, "version", 1);
        JsonElement recipesElement = root.GetProperty("recipes");
        if (recipesElement.ValueKind != JsonValueKind.Array || recipesElement.GetArrayLength() < 1 || recipesElement.GetArrayLength() > MaximumRecipes)
        {
            throw new HelperException(65, "Catalog recipes must be a bounded nonempty array.");
        }
        var recipes = new List<Recipe>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (JsonElement element in recipesElement.EnumerateArray())
        {
            Recipe recipe = ParseRecipe(element);
            if (!ids.Add(recipe.Id))
            {
                throw new HelperException(65, "Catalog recipe identifiers must be unique.");
            }
            recipes.Add(recipe);
        }
        return new Catalog(recipes);
    }

    private static Recipe ParseRecipe(JsonElement element)
    {
        JsonElement recipe = RequireExactObject(element,
            new[] { "id", "executable", "executableSha256", "arguments", "workingRoot", "workingDirectory", "environment", "timeoutMs", "maxOutputBytes", "artifacts" },
            "recipe");
        string id = RequireBoundedString(recipe, "id", 128);
        string executable = RequireBoundedString(recipe, "executable", 2048);
        string executableSha256 = RequireDigest(recipe, "executableSha256");
        string workingRoot = RequireBoundedString(recipe, "workingRoot", 16);
        string workingDirectory = RequireBoundedString(recipe, "workingDirectory", 1024);
        int timeout = RequireBoundedInteger(recipe, "timeoutMs", 50, MaximumTimeoutMilliseconds);
        int maxOutput = RequireBoundedInteger(recipe, "maxOutputBytes", 1, MaximumOutputBytes);
        if (!SafeIdentifier.IsMatch(id) || !IsSafeExecutablePath(executable) || (workingRoot != "input" && workingRoot != "work") || !IsSafeRelativePath(workingDirectory, allowDot: true))
        {
            throw new HelperException(65, "Catalog recipe contains an unsafe identity or path.");
        }

        JsonElement argumentsElement = recipe.GetProperty("arguments");
        if (argumentsElement.ValueKind != JsonValueKind.Array || argumentsElement.GetArrayLength() > MaximumArguments)
        {
            throw new HelperException(65, "Recipe arguments exceed their fixed bound.");
        }
        var arguments = new List<string>();
        foreach (JsonElement argument in argumentsElement.EnumerateArray())
        {
            string value = RequireBoundedScalarString(argument, MaximumArgumentBytes, "argument");
            RejectSecretOrTraversal(value, "argument");
            arguments.Add(value);
        }

        JsonElement environmentElement = RequireExactStringMap(recipe.GetProperty("environment"), "environment");
        if (environmentElement.EnumerateObject().Count() > MaximumEnvironmentEntries)
        {
            throw new HelperException(65, "Recipe environment exceeds its fixed bound.");
        }
        var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (JsonProperty property in environmentElement.EnumerateObject())
        {
            if (!Regex.IsMatch(property.Name, "^[A-Za-z_][A-Za-z0-9_]{0,127}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking) || ForbiddenEnvironmentName.IsMatch(property.Name))
            {
                throw new HelperException(65, "Recipe environment contains a forbidden name.");
            }
            string value = RequireBoundedScalarString(property.Value, MaximumEnvironmentValueBytes, "environment value");
            RejectSecretOrTraversal(value, "environment value", rejectTraversal: false);
            if (!environment.TryAdd(property.Name, value))
            {
                throw new HelperException(65, "Recipe environment contains duplicate names.");
            }
        }

        JsonElement artifactsElement = recipe.GetProperty("artifacts");
        if (artifactsElement.ValueKind != JsonValueKind.Array || artifactsElement.GetArrayLength() > MaximumArtifacts)
        {
            throw new HelperException(65, "Recipe artifacts exceed their fixed bound.");
        }
        var artifacts = new List<string>();
        foreach (JsonElement artifact in artifactsElement.EnumerateArray())
        {
            string value = RequireBoundedScalarString(artifact, 1024, "artifact path");
            if (!IsSafeRelativePath(value, allowDot: false))
            {
                throw new HelperException(65, "Recipe artifact path is unsafe.");
            }
            artifacts.Add(value.Replace('\\', '/'));
        }
        return new Recipe(id, executable, executableSha256, arguments, workingRoot, workingDirectory, environment, timeout, maxOutput, artifacts);
    }

    private static JsonDocument ParseJson(byte[] bytes, string label)
    {
        try
        {
            return JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 16 });
        }
        catch (JsonException)
        {
            throw new HelperException(65, $"{label} is not valid bounded JSON.");
        }
    }

    private static JsonElement RequireExactObject(JsonElement element, IReadOnlyCollection<string> properties, string label)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            throw new HelperException(65, $"{label} must be an exact object.");
        }
        JsonProperty[] actual = element.EnumerateObject().ToArray();
        if (actual.Length != properties.Count || actual.Any(property => !properties.Contains(property.Name, StringComparer.Ordinal)) || actual.Select(property => property.Name).Distinct(StringComparer.Ordinal).Count() != actual.Length)
        {
            throw new HelperException(65, $"{label} does not use the exact v1 schema.");
        }
        return element;
    }

    private static JsonElement RequireExactStringMap(JsonElement element, string label)
    {
        if (element.ValueKind != JsonValueKind.Object || element.EnumerateObject().Select(property => property.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() != element.EnumerateObject().Count())
        {
            throw new HelperException(65, $"{label} must be an exact case-insensitive string map.");
        }
        return element;
    }

    private static string RequireBoundedString(JsonElement parent, string name, int maximumBytes) =>
        RequireBoundedScalarString(parent.GetProperty(name), maximumBytes, name);

    private static string RequireBoundedScalarString(JsonElement element, int maximumBytes, string label)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw new HelperException(65, $"{label} must be a string.");
        }
        string value = element.GetString() ?? string.Empty;
        if (value.Length == 0 || Encoding.UTF8.GetByteCount(value) > maximumBytes || value.Any(character => character == '\0' || character == '\r' || character == '\n'))
        {
            throw new HelperException(65, $"{label} must be a bounded nonempty single-line string.");
        }
        return value;
    }

    private static string RequireDigest(JsonElement parent, string name)
    {
        string value = RequireBoundedString(parent, name, 64).ToLowerInvariant();
        if (value.Length != 64 || value.Any(character => !Uri.IsHexDigit(character)))
        {
            throw new HelperException(65, $"{name} must be a SHA-256 digest.");
        }
        return value;
    }

    private static void RequireExactString(JsonElement parent, string name, string expected)
    {
        if (parent.GetProperty(name).ValueKind != JsonValueKind.String || !StringComparer.Ordinal.Equals(parent.GetProperty(name).GetString(), expected))
        {
            throw new HelperException(65, $"{name} is not the exact supported value.");
        }
    }

    private static void RequireExactInteger(JsonElement parent, string name, int expected)
    {
        if (parent.GetProperty(name).ValueKind != JsonValueKind.Number || !parent.GetProperty(name).TryGetInt32(out int value) || value != expected)
        {
            throw new HelperException(65, $"{name} is not the exact supported version.");
        }
    }

    private static int RequireBoundedInteger(JsonElement parent, string name, int minimum, int maximum)
    {
        if (parent.GetProperty(name).ValueKind != JsonValueKind.Number || !parent.GetProperty(name).TryGetInt32(out int value) || value < minimum || value > maximum)
        {
            throw new HelperException(65, $"{name} is outside its fixed integer bound.");
        }
        return value;
    }

    private static ExecutableIdentity CaptureExecutableIdentity(string executable)
    {
        EnsureConcreteFile(executable, "recipe executable");
        EnsureNoReparseComponents(Path.GetPathRoot(executable)!, executable);
        string canonical = Path.GetFullPath(executable);
        var metadata = new FileInfo(canonical);
        byte[] bytes = ReadBoundedFile(canonical, 256 * 1024 * 1024, "recipe executable");
        return new ExecutableIdentity(canonical, metadata.Length, metadata.LastWriteTimeUtc, Sha256Hex(bytes));
    }

    private static void AssertExecutableUnchanged(ExecutableIdentity identity, string expectedDigest)
    {
        ExecutableIdentity current = CaptureExecutableIdentity(identity.CanonicalPath);
        if (!SamePath(identity.CanonicalPath, current.CanonicalPath) || identity.Length != current.Length || identity.LastWriteUtc != current.LastWriteUtc ||
            !FixedTimeHexEquals(identity.Sha256, current.Sha256) || !FixedTimeHexEquals(current.Sha256, expectedDigest))
        {
            throw new HelperException(74, "Recipe executable identity changed or differs from its catalog digest.");
        }
    }

    private static byte[] ReadBoundedFile(string path, int maximumBytes, string label)
    {
        var metadata = new FileInfo(path);
        if (!metadata.Exists || metadata.Length <= 0 || metadata.Length > maximumBytes)
        {
            throw new HelperException(66, $"{label} is absent, empty, or oversized.");
        }
        byte[] bytes = File.ReadAllBytes(path);
        if (bytes.LongLength != metadata.Length)
        {
            throw new HelperException(66, $"{label} changed while it was read.");
        }
        return bytes;
    }

    private static string ResolveCurrentExecutable()
    {
        string? processPath = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(processPath) || !Path.IsPathFullyQualified(processPath))
        {
            throw new HelperException(66, "Helper executable identity is unavailable.");
        }
        string? entryLocation = Assembly.GetEntryAssembly()?.Location;
        if (!string.IsNullOrEmpty(entryLocation) && entryLocation.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
        {
            throw new HelperException(66, "Helper must run as the published fixed executable, not through a framework host.");
        }
        return Path.GetFullPath(processPath);
    }

    private static string RequireAbsolutePath(string value, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048 || value.Any(character => character == '\0' || character == '\r' || character == '\n') || !Path.IsPathFullyQualified(value) || value.StartsWith(@"\\", StringComparison.Ordinal) || value.StartsWith(@"\\?\", StringComparison.Ordinal))
        {
            throw new HelperException(64, $"{label} path must be a bounded absolute drive path.");
        }
        return Path.GetFullPath(value);
    }

    private static bool IsSafeExecutablePath(string value)
    {
        try
        {
            string path = RequireAbsolutePath(value, "executable");
            return Path.GetExtension(path).Equals(".exe", StringComparison.OrdinalIgnoreCase);
        }
        catch (HelperException)
        {
            return false;
        }
    }

    private static string ResolveOwnedRelativePath(string root, string relativePath, bool mustExist, string label)
    {
        if (!IsSafeRelativePath(relativePath, allowDot: true))
        {
            throw new HelperException(65, $"{label} is not a safe relative path.");
        }
        string candidate = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!IsInside(root, candidate))
        {
            throw new HelperException(65, $"{label} escaped its fixed root.");
        }
        if (mustExist && !File.Exists(candidate) && !Directory.Exists(candidate))
        {
            throw new HelperException(66, $"{label} does not exist.");
        }
        return candidate;
    }

    private static bool IsSafeRelativePath(string value, bool allowDot)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 1024 || Path.IsPathFullyQualified(value) || value.Any(character => character == '\0' || character == '\r' || character == '\n' || "<>:\"|?*".IndexOf(character) >= 0))
        {
            return false;
        }
        string[] parts = value.Split(new[] { '/', '\\' }, StringSplitOptions.None);
        return parts.All(part => part.Length > 0 && part != ".." && (allowDot || part != "."));
    }

    private static void RejectSecretOrTraversal(string value, string label, bool rejectTraversal = true)
    {
        if (SecretMaterial.IsMatch(value) || (rejectTraversal && value.Split(new[] { '/', '\\' }, StringSplitOptions.None).Contains("..", StringComparer.Ordinal)))
        {
            throw new HelperException(65, $"Recipe {label} contains secret-like or traversal material.");
        }
    }

    private static string ExpandTokens(string value, IReadOnlyDictionary<string, string> tokens, string label)
    {
        string expanded = value;
        foreach ((string token, string replacement) in tokens)
        {
            expanded = expanded.Replace(token, replacement, StringComparison.Ordinal);
        }
        if (Regex.IsMatch(expanded, "\\{[A-Z_]+\\}", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking) || Encoding.UTF8.GetByteCount(expanded) > MaximumEnvironmentValueBytes || expanded.Any(character => character == '\0' || character == '\r' || character == '\n'))
        {
            throw new HelperException(65, $"Recipe {label} contains an unknown token or exceeds its post-expansion bound.");
        }
        return expanded;
    }

    private static void EnsureConcreteDirectory(string path, string label)
    {
        var directory = new DirectoryInfo(path);
        if (!directory.Exists || (directory.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new HelperException(66, $"{label} is absent or is a reparse point.");
        }
    }

    private static void EnsureConcreteFile(string path, string label)
    {
        var file = new FileInfo(path);
        if (!file.Exists || (file.Attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new HelperException(66, $"{label} is absent or is a reparse point.");
        }
    }

    private static void EnsureNoReparseComponents(string root, string path)
    {
        string canonicalRoot = Path.GetFullPath(root);
        string canonicalPath = Path.GetFullPath(path);
        if (!IsInside(canonicalRoot, canonicalPath))
        {
            throw new HelperException(66, "Path escaped its fixed root.");
        }
        string relative = Path.GetRelativePath(canonicalRoot, canonicalPath);
        string current = canonicalRoot;
        if ((new DirectoryInfo(current).Attributes & FileAttributes.ReparsePoint) != 0)
        {
            throw new HelperException(66, "Path root is a reparse point.");
        }
        foreach (string component in relative.Split(new[] { '/', '\\' }, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            FileAttributes attributes = File.GetAttributes(current);
            if ((attributes & FileAttributes.ReparsePoint) != 0)
            {
                throw new HelperException(66, "Path contains a reparse point.");
            }
        }
    }

    private static bool SamePath(string left, string right) =>
        StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(left).TrimEnd(Path.DirectorySeparatorChar), Path.GetFullPath(right).TrimEnd(Path.DirectorySeparatorChar));

    private static bool IsInside(string root, string candidate)
    {
        string relative = Path.GetRelativePath(Path.GetFullPath(root), Path.GetFullPath(candidate));
        return relative == "." || (!relative.Equals("..", StringComparison.Ordinal) && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) && !Path.IsPathFullyQualified(relative));
    }

    private static string Sha256Hex(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static bool FixedTimeHexEquals(string left, string right)
    {
        try
        {
            return CryptographicOperations.FixedTimeEquals(Convert.FromHexString(left), Convert.FromHexString(right));
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private static void WriteNewFile(string path, byte[] bytes)
    {
        using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough);
        stream.Write(bytes);
        stream.Flush(flushToDisk: true);
    }

    private static void AtomicWrite(string temporaryPath, string finalPath, byte[] bytes)
    {
        WriteNewFile(temporaryPath, bytes);
        File.Move(temporaryPath, finalPath, overwrite: false);
    }

    private static void WriteDiagnostic(string message)
    {
        string safe = message.Length <= 512 ? message : message[..512];
        Console.Error.WriteLine(safe.Replace('\r', ' ').Replace('\n', ' '));
    }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = null,
        WriteIndented = false
    };

    private sealed record Invocation(string CatalogPath, string RequestPath, string OutputPath);
    private sealed record Request(string RequestId, string LeaseId, string RecipeId, string RecipeCatalogDigest, string HelperDigest);
    private sealed record Catalog(IReadOnlyList<Recipe> Recipes);
    private sealed record Recipe(
        string Id,
        string Executable,
        string ExecutableSha256,
        IReadOnlyList<string> Arguments,
        string WorkingRoot,
        string WorkingDirectory,
        IReadOnlyDictionary<string, string> Environment,
        int TimeoutMilliseconds,
        int MaxOutputBytes,
        IReadOnlyList<string> Artifacts);
    private sealed record ExecutableIdentity(string CanonicalPath, long Length, DateTime LastWriteUtc, string Sha256);
    private sealed record ProcessExecution(int ExitCode, string StandardOutput, string StandardError);
    private sealed record ResultOutput(string Path, long Size, string Sha256);

    private sealed class SharedOutputBudget
    {
        private int remaining;
        internal SharedOutputBudget(int maximumBytes) => remaining = maximumBytes;
        internal int Take(int requested)
        {
            while (true)
            {
                int observed = Volatile.Read(ref remaining);
                if (observed <= 0)
                {
                    return 0;
                }
                int accepted = Math.Min(observed, requested);
                if (Interlocked.CompareExchange(ref remaining, observed - accepted, observed) == observed)
                {
                    return accepted;
                }
            }
        }
    }

    private sealed class HelperException : Exception
    {
        internal HelperException(int exitCode, string message) : base(message) => ExitCode = exitCode;
        internal int ExitCode { get; }
    }
}
