using System;
using System.Buffers;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32.SafeHandles;

namespace Sxsy.B122.RepositoryRunner;

internal static class Program
{
    private const string RequestSchema = "sxsy-b122.repository-supervisor-request";
    private const string StateSchema = "sxsy-b122.repository-supervisor-state";
    private const string TerminalSchema = "sxsy-b122.repository-supervisor-terminal";
    private const int MaximumDocumentBytes = 256 * 1024;
    private const int MaximumArguments = 128;
    private const int MaximumEnvironmentEntries = 64;
    private const int MaximumOutputBytes = 1024 * 1024;
    private const int MaximumTimeoutMilliseconds = 24 * 60 * 60 * 1000;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint HandleFlagInherit = 0x00000001;
    private const uint JobObjectLimitKillOnJobClose = 0x00002000;
    private const uint JobObjectTerminate = 0x0008;
    private const uint JobObjectQuery = 0x0004;
    private const uint JobObjectAssignProcess = 0x0001;
    private const uint Synchronize = 0x00100000;
    private const uint Infinite = 0xffffffff;
    private const uint WaitObject0 = 0;
    private const int JobObjectBasicAccountingInformation = 1;
    private const int JobObjectExtendedLimitInformationClass = 9;
    private static readonly IntPtr ProcThreadAttributeHandleList = new(0x00020002);
    private static readonly IntPtr ProcThreadAttributeJobList = new(0x0002000d);

    private static readonly Regex SafeDigest = new("^[a-f0-9]{64}$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SafeManagedId = new("^managed:[a-f0-9]{64}$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SafeAction = new("^(?:run_target|launch_web_app|venv|rebuild_venv|pipeline_local_gate|pipeline_clean_reproduction|shield_change_scan|shield_codebase_audit|shield_supply_chain|release_shield|trusted_bootstrap)$", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex SecretEnvironmentName = new("(?:^|_)(?:PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|AUTHORIZATION|COOKIE|API_KEY|PRIVATE_KEY|ACCESS_KEY|DATABASE_URL|DSN)(?:$|_)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && StringComparer.Ordinal.Equals(args[0], "--self-test"))
            {
                return await SelfTestAsync().ConfigureAwait(false);
            }
            if (args.Length == 3 && StringComparer.Ordinal.Equals(args[0], "--self-test-child"))
            {
                return await SelfTestChildAsync(args[1], args[2]).ConfigureAwait(false);
            }
            if (args.Length == 1 && StringComparer.Ordinal.Equals(args[0], "--self-test-grandchild"))
            {
                await Task.Delay(TimeSpan.FromMinutes(2)).ConfigureAwait(false);
                return 0;
            }
            if (args.Length == 2 && StringComparer.Ordinal.Equals(args[0], "--self-test-post-create"))
            {
                return await SelfTestPostCreateAsync(args[1]).ConfigureAwait(false);
            }
            if (args.Length == 5 && StringComparer.Ordinal.Equals(args[0], "--recipe"))
            {
                return await RunTypedRecipeAsync(args[1], args[2], args[3], args[4]).ConfigureAwait(false);
            }
            if (args.Length == 4 && StringComparer.Ordinal.Equals(args[0], "--supervise"))
            {
                return await SuperviseAsync(args[1], args[2], args[3]).ConfigureAwait(false);
            }
            if (args.Length == 4 && StringComparer.Ordinal.Equals(args[0], "--observe"))
            {
                return Observe(args[1], args[2], args[3]);
            }
            if (args.Length == 4 && StringComparer.Ordinal.Equals(args[0], "--verify-terminal"))
            {
                return VerifyTerminal(args[1], args[2], args[3]);
            }
            if (args.Length == 6 && StringComparer.Ordinal.Equals(args[0], "--terminate"))
            {
                return await TerminateAsync(args[1], args[2], args[3], ParseBound(args[4], 0, 60_000), ParseBound(args[5], 1, 60_000)).ConfigureAwait(false);
            }
            Diagnostic("Expected one exact repository-runner mode.");
            return 64;
        }
        catch (RunnerException error)
        {
            Diagnostic(error.Message);
            return error.ExitCode;
        }
        catch (Exception error)
        {
            Diagnostic(args.Length > 0 && args[0].StartsWith("--self-test", StringComparison.Ordinal)
                ? "Repository runner self-test failed: " + error.GetType().Name + ": " + error.Message
                : "Repository process-tree helper failed closed.");
            return 70;
        }
    }

    private static async Task<int> RunTypedRecipeAsync(string recipeId, string inputArgument, string workArgument, string expectedConfigDigest)
    {
        string[] supported = { "full_sandbox", "rebuild_full_sandbox", "quarantine", "pipeline_local_gate", "pipeline_clean_reproduction", "shield_change_scan", "shield_codebase_audit", "shield_supply_chain", "release_shield" };
        if (!supported.Contains(recipeId, StringComparer.Ordinal)) throw new RunnerException(64, "Recipe mode is not one of the fixed typed identifiers.");
        string inputRoot = RequireConcreteDirectory(inputArgument, "recipe input root");
        string workRoot = RequireConcreteDirectory(workArgument, "recipe work root");
        if (SamePath(inputRoot, workRoot) || !SafeDigest.IsMatch(expectedConfigDigest) || expectedConfigDigest.All(character => character == '0'))
        {
            WriteIncompleteRecipeReport(workRoot, recipeId, new[] { "reviewed_recipe_configuration" });
            return 78;
        }
        string configPath = Path.Combine(inputRoot, ".b122", "sandbox-recipes-v1.json");
        byte[] configBytes;
        try
        {
            EnsureNoReparseComponents(inputRoot, configPath, "typed recipe configuration");
            configBytes = ReadBoundedFile(configPath, MaximumDocumentBytes, "typed recipe configuration");
        }
        catch (RunnerException) { WriteIncompleteRecipeReport(workRoot, recipeId, new[] { "reviewed_recipe_configuration" }); return 78; }
        if (!FixedEquals(Convert.ToHexString(SHA256.HashData(configBytes)).ToLowerInvariant(), expectedConfigDigest.ToLowerInvariant()))
        {
            WriteIncompleteRecipeReport(workRoot, recipeId, new[] { "reviewed_recipe_configuration" });
            return 78;
        }
        TypedRecipe recipe = ParseTypedRecipe(configBytes, recipeId, inputRoot, workRoot);
        using SafeJobHandle job = CreateKillOnCloseJob(null);
        using FileStream executableLock = OpenVerifiedExecutable(recipe.Executable, recipe.ExecutableSha256);
        using StartedProcess child = StartSuspendedProcess(recipe.Executable, recipe.Arguments, recipe.WorkingDirectory, recipe.Environment, job);
        if (ResumeThread(child.ThreadHandle) == uint.MaxValue) throw LastError(74, "Typed recipe could not resume its reviewed tool.");
        child.ThreadHandle.Dispose();
        var budget = new SharedOutputBudget(recipe.MaxOutputBytes);
        Task<byte[]> stdout = DrainBoundedAsync(child.StandardOutput, budget);
        Task<byte[]> stderr = DrainBoundedAsync(child.StandardError, budget);
        Task<uint> exited = WaitForHandleAsync(child.ProcessHandle, CancellationToken.None);
        Task timeout = Task.Delay(recipe.TimeoutMs);
        bool timedOut = ReferenceEquals(await Task.WhenAny(exited, timeout).ConfigureAwait(false), timeout);
        if (timedOut && !TerminateJobObject(job, 124)) throw LastError(75, "Timed-out typed recipe could not be contained.");
        uint exitCode = await exited.ConfigureAwait(false);
        byte[][] output = await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
        WriteNewBoundedFile(Path.Combine(workRoot, "process.stdout.txt"), output[0]);
        WriteNewBoundedFile(Path.Combine(workRoot, "process.stderr.txt"), output[1]);

        string[] required = RequiredCoverage(recipeId);
        var unavailable = required.Where(dimension => !recipe.Coverage.Any(item => item.Dimension == dimension && item.FixtureId.Length > 0)).ToList();
        bool securityRecipe = recipeId.StartsWith("shield_", StringComparison.Ordinal) || recipeId == "release_shield";
        bool advisoryRecipe = recipeId is "shield_supply_chain" or "release_shield";
        if (securityRecipe && recipe.ScannerFixtureIds.Count == 0) unavailable.Add("scanner_freshness");
        if (advisoryRecipe && recipe.AdvisoryFixtureIds.Count == 0) unavailable.Add("advisory_freshness");
        if (budget.Truncated) unavailable.Add("output_truncated");
        string outcome = timedOut ? "timed_out" : exitCode != 0 ? "failed" : unavailable.Count > 0 ? "incomplete" : "completed";
        var report = new
        {
            schema = "sxsy-b122.typed-recipe-result",
            version = 1,
            recipeId,
            configurationSha256 = expectedConfigDigest.ToLowerInvariant(),
            helperSha256 = Sha256File(ResolveSelf(), 512 * 1024 * 1024),
            toolSha256 = recipe.ExecutableSha256,
            outcome,
            exitCode = checked((int)exitCode),
            output = new
            {
                stdoutSha256 = Convert.ToHexString(SHA256.HashData(output[0])).ToLowerInvariant(),
                stdoutBytes = output[0].Length,
                stderrSha256 = Convert.ToHexString(SHA256.HashData(output[1])).ToLowerInvariant(),
                stderrBytes = output[1].Length,
                truncated = budget.Truncated
            },
            coverage = recipe.Coverage.Select(item => new { dimension = item.Dimension, status = "covered", fixtureId = item.FixtureId }).ToArray(),
            scannerFixtureIds = recipe.ScannerFixtureIds,
            advisoryFixtureIds = recipe.AdvisoryFixtureIds,
            unavailableDimensions = unavailable.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray()
        };
        WriteNewBoundedFile(Path.Combine(workRoot, "b122-recipe-evidence.json"), JsonSerializer.SerializeToUtf8Bytes(report, JsonOptions));
        return outcome == "completed" ? 0 : outcome == "incomplete" ? 78 : timedOut ? 75 : checked((int)Math.Min(exitCode, 255));
    }

    private static TypedRecipe ParseTypedRecipe(byte[] bytes, string recipeId, string inputRoot, string workRoot)
    {
        using JsonDocument document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 16 });
        JsonElement root = ExactObject(document.RootElement, new[] { "schema", "version", "recipes" }, "typed recipe document");
        if (RequiredString(root, "schema", 128) != "sxsy-b122.typed-recipes" || RequiredInt(root, "version", 1, 1) != 1) throw new RunnerException(65, "Typed recipe document identity is invalid.");
        JsonElement recipes = root.GetProperty("recipes");
        if (recipes.ValueKind != JsonValueKind.Object || !recipes.TryGetProperty(recipeId, out JsonElement selected)) throw new RunnerException(65, "Typed recipe is absent from the reviewed configuration.");
        JsonElement recipe = ExactObject(selected, new[] { "executable", "executableSha256", "arguments", "workingRoot", "workingDirectory", "environment", "timeoutMs", "maxOutputBytes", "coverage", "scannerFixtureIds", "advisoryFixtureIds" }, recipeId);
        string executable = ResolveOwnedRelativePath(inputRoot, RequiredString(recipe, "executable", 2048), "typed recipe executable");
        string executableSha256 = RequiredDigest(recipe, "executableSha256");
        string workingRootName = RequiredString(recipe, "workingRoot", 16);
        string selectedRoot = workingRootName == "input" ? inputRoot : workingRootName == "work" ? workRoot : throw new RunnerException(65, "Typed recipe working root is invalid.");
        string workingDirectory = ResolveOwnedRelativePath(selectedRoot, RequiredString(recipe, "workingDirectory", 1024), "typed recipe working directory");
        if (!Directory.Exists(workingDirectory)) throw new RunnerException(65, "Typed recipe working directory is absent.");
        EnsureNoReparseComponents(inputRoot, executable, "typed recipe executable");
        EnsureNoReparseComponents(selectedRoot, workingDirectory, "typed recipe working directory");
        IReadOnlyList<string> arguments = ReadStringArray(recipe.GetProperty("arguments"), "arguments", MaximumArguments, 4096)
            .Select(value => ExpandRecipeTokens(value, inputRoot, workRoot)).ToArray();
        IReadOnlyDictionary<string, string> environment = ReadTypedEnvironment(recipe.GetProperty("environment"), inputRoot, workRoot);
        int timeoutMs = RequiredInt(recipe, "timeoutMs", 50, MaximumTimeoutMilliseconds);
        int maxOutputBytes = RequiredInt(recipe, "maxOutputBytes", 1, MaximumOutputBytes);
        IReadOnlyList<string> scannerFixtures = ReadStringArray(recipe.GetProperty("scannerFixtureIds"), "scannerFixtureIds", 32, 256);
        IReadOnlyList<string> advisoryFixtures = ReadStringArray(recipe.GetProperty("advisoryFixtureIds"), "advisoryFixtureIds", 32, 256);
        JsonElement coverageElement = recipe.GetProperty("coverage");
        if (coverageElement.ValueKind != JsonValueKind.Array || coverageElement.GetArrayLength() > 32) throw new RunnerException(65, "Typed recipe coverage is not bounded.");
        var coverage = new List<CoverageItem>();
        foreach (JsonElement item in coverageElement.EnumerateArray())
        {
            JsonElement exact = ExactObject(item, new[] { "dimension", "fixtureId" }, "coverage item");
            var parsed = new CoverageItem(RequiredString(exact, "dimension", 128), RequiredString(exact, "fixtureId", 256));
            if (coverage.Any(existing => existing.Dimension == parsed.Dimension)) throw new RunnerException(65, "Typed recipe coverage contains a duplicate dimension.");
            coverage.Add(parsed);
        }
        return new TypedRecipe(executable, executableSha256, arguments, workingDirectory, environment, timeoutMs, maxOutputBytes, coverage, scannerFixtures, advisoryFixtures);
    }

    private static IReadOnlyDictionary<string, string> ReadTypedEnvironment(JsonElement value, string inputRoot, string workRoot)
    {
        if (value.ValueKind != JsonValueKind.Object || value.EnumerateObject().Count() > MaximumEnvironmentEntries) throw new RunnerException(65, "Typed recipe environment is not bounded.");
        string temporary = Path.Combine(workRoot, ".tmp");
        Directory.CreateDirectory(temporary);
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["SystemRoot"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            ["WINDIR"] = Environment.GetFolderPath(Environment.SpecialFolder.Windows),
            ["TEMP"] = temporary,
            ["TMP"] = temporary
        };
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!Regex.IsMatch(property.Name, "^[A-Za-z_][A-Za-z0-9_]{0,127}$", RegexOptions.CultureInvariant) || SecretEnvironmentName.IsMatch(property.Name) || property.Value.ValueKind != JsonValueKind.String || result.ContainsKey(property.Name)) throw new RunnerException(65, "Typed recipe environment entry is invalid, secret-bearing, or overrides a fixed value.");
            string item = property.Value.GetString() ?? string.Empty;
            if (item.IndexOf('\0') >= 0 || item.Length > 8192) throw new RunnerException(65, "Typed recipe environment value is invalid or oversized.");
            result.Add(property.Name, ExpandRecipeTokens(item, inputRoot, workRoot));
        }
        return result;
    }

    private static IReadOnlyList<string> ReadStringArray(JsonElement value, string label, int maximumItems, int maximumCharacters)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > maximumItems) throw new RunnerException(65, $"{label} is not a bounded array.");
        var result = new List<string>();
        foreach (JsonElement item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) throw new RunnerException(65, $"{label} contains a non-string value.");
            string text = item.GetString() ?? string.Empty;
            if (text.Length == 0 || text.Length > maximumCharacters || text.IndexOf('\0') >= 0 || text.IndexOf('\r') >= 0 || text.IndexOf('\n') >= 0) throw new RunnerException(65, $"{label} contains an invalid value.");
            result.Add(text);
        }
        return result;
    }

    private static string ExpandRecipeTokens(string value, string inputRoot, string workRoot) => value
        .Replace("{INPUT_ROOT}", inputRoot, StringComparison.Ordinal)
        .Replace("{WORK_ROOT}", workRoot, StringComparison.Ordinal);

    private static void EnsureNoReparseComponents(string root, string candidate, string label)
    {
        string relative = Path.GetRelativePath(root, candidate);
        if (Path.IsPathFullyQualified(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new RunnerException(65, $"{label} escaped its fixed root.");
        string current = root;
        foreach (string component in relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            FileAttributes attributes;
            try { attributes = File.GetAttributes(current); }
            catch (IOException) { throw new RunnerException(65, $"{label} contains an absent path component."); }
            catch (UnauthorizedAccessException) { throw new RunnerException(65, $"{label} contains an inaccessible path component."); }
            if ((attributes & FileAttributes.ReparsePoint) != 0) throw new RunnerException(65, $"{label} contains a linked path component.");
        }
    }

    private static string[] RequiredCoverage(string recipeId) => recipeId switch
    {
        "full_sandbox" or "rebuild_full_sandbox" => new[] { "isolation", "production_data", "ambient_credentials" },
        "quarantine" => new[] { "isolation", "quarantine" },
        "pipeline_local_gate" => new[] { "correctness", "isolation", "production_data", "ambient_credentials" },
        "pipeline_clean_reproduction" => new[] { "correctness", "reproduction", "isolation", "production_data", "ambient_credentials" },
        "shield_change_scan" => new[] { "secrets", "pii", "security_defects" },
        "shield_codebase_audit" => new[] { "secrets", "history", "insecure_paths", "permissions", "infrastructure" },
        "shield_supply_chain" => new[] { "vulnerabilities", "licenses", "provenance", "sbom" },
        "release_shield" => new[] { "secrets", "pii", "security_defects", "history", "insecure_paths", "permissions", "infrastructure", "vulnerabilities", "licenses", "provenance", "sbom", "isolation" },
        _ => Array.Empty<string>()
    };

    private static string RequireConcreteDirectory(string value, string label)
    {
        string path = RequireAbsolutePath(value, label);
        var info = new DirectoryInfo(path);
        if (!info.Exists || (info.Attributes & FileAttributes.ReparsePoint) != 0) throw new RunnerException(65, $"{label} is absent or linked.");
        return info.FullName;
    }

    private static DirectoryLockSet OpenVerifiedDirectoryChain(string repositoryRoot, string workingDirectory)
    {
        var paths = new List<string>();
        AddChain(repositoryRoot, workingDirectory, paths);
        var handles = new List<SafeFileHandle>();
        try
        {
            foreach (string path in paths.Distinct(StringComparer.OrdinalIgnoreCase)) handles.Add(OpenVerifiedDirectory(path));
            return new DirectoryLockSet(handles);
        }
        catch
        {
            foreach (SafeFileHandle handle in handles) handle.Dispose();
            throw;
        }
    }

    private static void AddChain(string root, string candidate, List<string> paths)
    {
        string current = Path.GetFullPath(root);
        paths.Add(current);
        string relative = Path.GetRelativePath(current, candidate);
        if (Path.IsPathFullyQualified(relative) || relative == ".." || relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal)) throw new RunnerException(65, "Directory lock chain escaped its fixed root.");
        foreach (string component in relative.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar }, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, component);
            paths.Add(current);
        }
    }

    private static SafeFileHandle OpenVerifiedDirectory(string path)
    {
        const uint fileShareRead = 0x00000001;
        const uint fileShareWrite = 0x00000002;
        const uint openExisting = 3;
        const uint fileFlagBackupSemantics = 0x02000000;
        SafeFileHandle handle = CreateFileW(path, 0, fileShareRead | fileShareWrite, IntPtr.Zero, openExisting, fileFlagBackupSemantics, IntPtr.Zero);
        if (handle.IsInvalid) throw LastError(65, "Reviewed directory could not be locked against rename or replacement.");
        try
        {
            var finalPath = new StringBuilder(32_768);
            uint length = GetFinalPathNameByHandleW(handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity) throw LastError(65, "Reviewed directory final identity is unavailable.");
            string canonical = NormalizeFinalHandlePath(finalPath.ToString());
            if (!SamePath(canonical, path) || (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0) throw new RunnerException(65, "Reviewed directory changed identity or became linked before CreateProcess.");
            return handle;
        }
        catch
        {
            handle.Dispose();
            throw;
        }
    }

    private static string NormalizeFinalHandlePath(string path)
    {
        if (path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return @"\\" + path[8..];
        if (path.StartsWith(@"\\?\", StringComparison.OrdinalIgnoreCase)) return path[4..];
        return path;
    }

    private static string ResolveOwnedRelativePath(string root, string value, string label)
    {
        if (Path.IsPathFullyQualified(value) || value.IndexOf('\0') >= 0) throw new RunnerException(65, $"{label} must be relative.");
        string path = Path.GetFullPath(Path.Combine(root, value));
        if (!Inside(path, root)) throw new RunnerException(65, $"{label} escaped its fixed root.");
        return path;
    }

    private static void WriteIncompleteRecipeReport(string workRoot, string recipeId, IReadOnlyList<string> unavailable)
    {
        Directory.CreateDirectory(workRoot);
        var report = new { schema = "sxsy-b122.typed-recipe-result", version = 1, recipeId, outcome = "incomplete", unavailableDimensions = unavailable };
        string path = Path.Combine(workRoot, "b122-recipe-evidence.json");
        if (!File.Exists(path)) WriteNewBoundedFile(path, JsonSerializer.SerializeToUtf8Bytes(report, JsonOptions));
    }

    private static void WriteNewBoundedFile(string path, byte[] bytes)
    {
        if (bytes.Length > MaximumOutputBytes || File.Exists(path)) throw new RunnerException(74, "Typed recipe output is oversized or would overwrite an existing file.");
        File.WriteAllBytes(path, bytes);
    }

    private static async Task<int> SuperviseAsync(string requestArgument, string stateArgument, string expectedRequestDigest)
    {
        string requestPath = RequireAbsolutePath(requestArgument, "request");
        string statePath = RequireAbsolutePath(stateArgument, "state");
        Request request = ReadRequest(requestPath, expectedRequestDigest);
        if (!SamePath(request.StatePath, statePath)) throw new RunnerException(65, "Request state path does not match the exact invocation.");
        VerifyHelperIdentity(request);
        if (File.Exists(statePath)) throw new RunnerException(73, "Supervisor state already exists for this identity.");

        string requestDigest = expectedRequestDigest.ToLowerInvariant();
        string jobName = JobName(request.SupervisorId);
        using DirectoryLockSet directoryLocks = OpenVerifiedDirectoryChain(request.RepositoryRoot, request.WorkingDirectory);
        using SafeJobHandle job = CreateKillOnCloseJob(jobName);
        using FileStream executableLock = OpenVerifiedExecutable(request.Executable, request.ExecutableSha256);
        using ECDsa terminalSigner = ECDsa.Create(ECCurve.NamedCurves.nistP256);
        string signingPublicKeySpki = Convert.ToBase64String(terminalSigner.ExportSubjectPublicKeyInfo());
        string signingPublicKeySha256 = Sha256Bytes(Convert.FromBase64String(signingPublicKeySpki));
        using StartedProcess child = StartSuspendedProcess(request.Executable, request.Arguments, request.WorkingDirectory, request.Environment, job);
        string startedAt = DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        SupervisorState state = new(
            StateSchema, 3, request.SupervisorId, request.OperationId, request.Action, request.TargetSnapshotId, request.SessionId, request.AuthorityId, request.RepositoryRoot, request.ManifestSha256,
            ResolveSelf(), request.HelperSha256, requestDigest, signingPublicKeySpki, signingPublicKeySha256, jobName,
            Environment.ProcessId, child.ProcessId, startedAt,
            "running", null, false);
        WriteStateNew(statePath, state);
        await WaitForBindingAckAsync(request.BindingAckPath, requestDigest, 30_000).ConfigureAwait(false);
        if (ResumeThread(child.ThreadHandle) == uint.MaxValue) throw LastError(74, "Could not resume the Job-Object child.");
        child.ThreadHandle.Dispose();

        var budget = new SharedOutputBudget(request.MaxOutputBytes);
        Task<byte[]> stdout = DrainBoundedAsync(child.StandardOutput, budget);
        Task<byte[]> stderr = DrainBoundedAsync(child.StandardError, budget);
        Task<uint> exited = WaitForHandleAsync(child.ProcessHandle, CancellationToken.None);
        Task timeout = Task.Delay(request.TimeoutMs);
        bool timedOut = ReferenceEquals(await Task.WhenAny(exited, timeout).ConfigureAwait(false), timeout);
        if (timedOut)
        {
            if (!TerminateJobObject(job, 124)) throw LastError(75, "Timed-out Job Object could not be terminated.");
        }
        uint exitCode = await exited.ConfigureAwait(false);
        byte[][] output = await Task.WhenAll(stdout, stderr).ConfigureAwait(false);
        await Console.OpenStandardOutput().WriteAsync(output[0]).ConfigureAwait(false);
        await Console.OpenStandardError().WriteAsync(output[1]).ConfigureAwait(false);
        string terminal = timedOut ? "timed_out" : exitCode == 0 ? "completed" : "failed";
        SupervisorState completed = state with { State = terminal, ExitCode = checked((int)exitCode), OutputTruncated = budget.Truncated };
        WriteStateReplace(statePath, completed);
        WriteTerminalNew(request.TerminalPath, CreateTerminalReceipt(request, requestDigest, signingPublicKeySha256, startedAt,
            DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture), terminal, checked((int)exitCode), budget.Truncated, terminalSigner));
        return timedOut ? 75 : checked((int)Math.Min(exitCode, 255));
    }

    private static int Observe(string requestArgument, string stateArgument, string expectedRequestDigest)
    {
        string requestPath = RequireAbsolutePath(requestArgument, "request");
        string statePath = RequireAbsolutePath(stateArgument, "state");
        Request request = ReadRequest(requestPath, expectedRequestDigest);
        if (!SamePath(request.StatePath, statePath)) throw new RunnerException(65, "Request state path does not match the exact invocation.");
        VerifyHelperIdentity(request);
        // The repository child runs as the same current user and can rewrite
        // its on-disk state. Observation therefore derives the kernel identity
        // from the immutable request identity and consults only the exact Job.
        using SafeJobHandle job = OpenJobObject(JobObjectQuery, false, JobName(request.SupervisorId));
        if (job.IsInvalid) return 3;
        return ActiveProcessCount(job) > 0 ? 0 : 3;
    }

    private static async Task<int> TerminateAsync(string requestArgument, string stateArgument, string expectedRequestDigest, int gracefulMs, int forceMs)
    {
        string requestPath = RequireAbsolutePath(requestArgument, "request");
        string statePath = RequireAbsolutePath(stateArgument, "state");
        Request request = ReadRequest(requestPath, expectedRequestDigest);
        if (!SamePath(request.StatePath, statePath)) throw new RunnerException(65, "Request state path does not match the exact invocation.");
        VerifyHelperIdentity(request);
        // Never let mutable disk state select a PID or Job for termination.
        // The request-bound supervisor identity deterministically names the
        // one kernel object this invocation may affect.
        using SafeJobHandle job = OpenJobObject(JobObjectTerminate | JobObjectQuery, false, JobName(request.SupervisorId));
        if (job.IsInvalid || ActiveProcessCount(job) == 0) return 3;

        if (gracefulMs > 0)
        {
            // The state file is readable by the same current-user child and its
            // PID is not termination authority. Give the exact Job a bounded
            // natural-exit window, then terminate only that kernel object.
            await WaitUntilAsync(() => ActiveProcessCount(job) == 0, gracefulMs).ConfigureAwait(false);
        }
        if (ActiveProcessCount(job) > 0 && !TerminateJobObject(job, 130)) throw LastError(74, "The exact Job Object rejected forced containment.");
        bool stopped = await WaitUntilAsync(() => ActiveProcessCount(job) == 0, forceMs).ConfigureAwait(false);
        if (!stopped) throw new RunnerException(75, "The exact Job Object did not stop within the bounded force window.");
        // Do not write a terminal claim here. The supervising helper owns its
        // original state object and records the observed process exit; the host
        // authenticates this terminate helper's exit separately. Termination
        // proves only that the tree stopped, never that prior effects rolled back.
        return 0;
    }

    private static async Task<int> SelfTestAsync()
    {
        string self = ResolveSelf();
        string root = Path.Combine(Path.GetTempPath(), "sxsy-b122-job-self-test-" + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture));
        Directory.CreateDirectory(root);
        string marker = Path.Combine(root, "tree.json");
        int childPid = 0;
        int grandchildPid = 0;
        bool grandchildObserved = false;
        bool atomicJobAssignment = false;
        bool terminated = false;
        bool noSurvivors = false;
        try
        {
            string selfTestJobName = @"Local\SxsyB122-SelfTest-" + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture);
            using SafeJobHandle job = CreateKillOnCloseJob(selfTestJobName);
            using StartedProcess child = StartSuspendedProcess(self, new[] { "--self-test-child", marker, selfTestJobName }, root, new Dictionary<string, string>(StringComparer.Ordinal), job);
            childPid = child.ProcessId;
            if (!IsProcessInJob(child.ProcessHandle, job, out atomicJobAssignment) || !atomicJobAssignment) throw LastError(74, "Self-test child was not atomically assigned at CreateProcess.");
            if (ResumeThread(child.ThreadHandle) == uint.MaxValue) throw LastError(74, "Self-test could not resume its child.");
            child.ThreadHandle.Dispose();
            DateTime deadline = DateTime.UtcNow.AddSeconds(5);
            while (DateTime.UtcNow < deadline && !File.Exists(marker)) await Task.Delay(20).ConfigureAwait(false);
            if (File.Exists(marker))
            {
                using JsonDocument document = JsonDocument.Parse(File.ReadAllBytes(marker));
                grandchildPid = document.RootElement.GetProperty("grandchildPid").GetInt32();
                grandchildObserved = grandchildPid > 0 && IsProcessAlive(grandchildPid);
            }
            if (!TerminateJobObject(job, 130)) throw LastError(74, "Self-test containment failed.");
            terminated = await WaitUntilAsync(() => ActiveProcessCount(job) == 0, 5_000).ConfigureAwait(false);
            noSurvivors = await WaitUntilAsync(() => !IsProcessAlive(childPid) && !IsProcessAlive(grandchildPid), 5_000).ConfigureAwait(false);
        }
        finally
        {
            try { Directory.Delete(root, true); } catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
        var receipt = new
        {
            schema = "sxsy-b122.repository-runner-self-test",
            version = 1,
            jobObjectCreated = true,
            childStartedSuspended = true,
            atomicJobAssignment,
            grandchildObserved,
            killOnClose = true,
            childTreeTerminated = terminated,
            noSurvivors
        };
        Console.Write(JsonSerializer.Serialize(receipt));
        return atomicJobAssignment && grandchildObserved && terminated && noSurvivors ? 0 : 1;
    }

    private static async Task<int> SelfTestChildAsync(string markerArgument, string jobName)
    {
        string marker = RequireAbsolutePath(markerArgument, "self-test marker");
        string self = ResolveSelf();
        using SafeJobHandle job = OpenJobObject(JobObjectAssignProcess | JobObjectQuery, false, jobName);
        if (job.IsInvalid) return 1;
        using StartedProcess grandchild = StartSuspendedProcess(self, new[] { "--self-test-grandchild" }, Path.GetDirectoryName(marker)!, new Dictionary<string, string>(StringComparer.Ordinal), job);
        if (!IsProcessInJob(grandchild.ProcessHandle, job, out bool alreadyAssigned) || !alreadyAssigned) return 1;
        if (ResumeThread(grandchild.ThreadHandle) == uint.MaxValue) return 1;
        grandchild.ThreadHandle.Dispose();
        File.WriteAllText(marker, JsonSerializer.Serialize(new { childPid = Environment.ProcessId, grandchildPid = grandchild.ProcessId }), new UTF8Encoding(false));
        await Task.Delay(TimeSpan.FromMinutes(2)).ConfigureAwait(false);
        return 0;
    }

    private static async Task<int> SelfTestPostCreateAsync(string markerArgument)
    {
        string marker = RequireAbsolutePath(markerArgument, "post-create self-test marker");
        string temporary = Path.GetFullPath(Path.GetTempPath());
        if (!Inside(marker, temporary)) throw new RunnerException(65, "The post-create self-test marker must remain under the operating-system temporary directory.");
        string parent = RequireConcreteDirectory(Path.GetDirectoryName(marker)!, "post-create self-test directory");
        EnsureNoReparseComponents(temporary, parent, "post-create self-test directory");
        if (File.Exists(marker) || Directory.Exists(marker)) throw new RunnerException(65, "The post-create self-test marker already exists.");
        using SafeJobHandle job = CreateKillOnCloseJob(@"Local\SxsyB122-PostCreate-" + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture));
        using StartedProcess child = StartSuspendedProcess(ResolveSelf(), new[] { "--self-test-grandchild" }, parent, new Dictionary<string, string>(StringComparer.Ordinal), job);
        if (!IsProcessInJob(child.ProcessHandle, job, out bool assigned) || !assigned) throw LastError(74, "The post-create self-test child was not atomically assigned.");
        File.WriteAllText(marker, JsonSerializer.Serialize(new { schema = "sxsy-b122.repository-runner-post-create", version = 1, supervisorPid = Environment.ProcessId, childPid = child.ProcessId, atomicallyAssigned = true }), new UTF8Encoding(false));
        await Task.Delay(TimeSpan.FromMinutes(2)).ConfigureAwait(false);
        return 1;
    }

    private static Request ReadRequest(string path, string expectedDigest)
    {
        byte[] bytes = ReadBoundedFile(path, MaximumDocumentBytes, "request");
        if (!SafeDigest.IsMatch(expectedDigest)
            || !FixedEquals(Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), expectedDigest.ToLowerInvariant()))
        {
            throw new RunnerException(65, "Request bytes do not match the immutable host-issued digest.");
        }
        using JsonDocument document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 16 });
        JsonElement root = ExactObject(document.RootElement, new[] { "schema", "version", "supervisorId", "operationId", "action", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "helperPath", "helperSha256", "executable", "executableSha256", "arguments", "workingDirectory", "environment", "lifecycle", "timeoutMs", "maxOutputBytes", "controlToken", "statePath", "bindingAckPath", "terminalPath" }, "request");
        string schema = RequiredString(root, "schema", 128);
        int version = RequiredInt(root, "version", 3, 3);
        string supervisorId = RequiredString(root, "supervisorId", 80);
        string operationId = RequiredString(root, "operationId", 256);
        string action = RequiredString(root, "action", 64);
        string targetSnapshotId = RequiredDigest(root, "targetSnapshotId");
        string? sessionId = OptionalIdentifier(root, "sessionId");
        string? authorityId = OptionalIdentifier(root, "authorityId");
        string repositoryRoot = RequireConcreteDirectory(RequiredString(root, "repositoryRoot", 4096), "repository root");
        string manifestSha256 = RequiredDigest(root, "manifestSha256");
        string helperPath = RequireAbsolutePath(RequiredString(root, "helperPath", 4096), "helper");
        string helperSha256 = RequiredDigest(root, "helperSha256");
        string executable = RequireAbsolutePath(RequiredString(root, "executable", 4096), "executable");
        string executableSha256 = RequiredDigest(root, "executableSha256");
        string workingDirectory = RequireConcreteDirectory(RequiredString(root, "workingDirectory", 4096), "working directory");
        string lifecycle = RequiredString(root, "lifecycle", 16);
        int timeoutMs = RequiredInt(root, "timeoutMs", 50, MaximumTimeoutMilliseconds);
        int maxOutputBytes = RequiredInt(root, "maxOutputBytes", 1, MaximumOutputBytes);
        string controlToken = RequiredDigest(root, "controlToken");
        string statePath = RequireAbsolutePath(RequiredString(root, "statePath", 4096), "state");
        string bindingAckPath = RequireAbsolutePath(RequiredString(root, "bindingAckPath", 4096), "binding acknowledgement");
        string terminalPath = RequireAbsolutePath(RequiredString(root, "terminalPath", 4096), "terminal receipt");
        if (schema != RequestSchema || !SafeManagedId.IsMatch(supervisorId) || !SafeAction.IsMatch(action) || lifecycle is not ("foreground" or "managed")) throw new RunnerException(65, "Request identity or lifecycle is invalid.");
        if (!Inside(workingDirectory, repositoryRoot)) throw new RunnerException(65, "Request working directory escaped the canonical repository root.");
        string repositoryVolume = Path.GetPathRoot(repositoryRoot) ?? throw new RunnerException(65, "Repository volume root is unavailable.");
        EnsureNoReparseComponents(repositoryVolume, repositoryRoot, "repository root");
        EnsureNoReparseComponents(repositoryRoot, workingDirectory, "working directory");
        string stateRoot = Path.GetDirectoryName(statePath) ?? throw new RunnerException(65, "Supervisor state root is absent.");
        string stem = supervisorId["managed:".Length..];
        if (!SamePath(statePath, Path.Combine(stateRoot, stem + ".state.json"))
            || !SamePath(bindingAckPath, Path.Combine(stateRoot, stem + ".binding-ack"))
            || !SamePath(terminalPath, Path.Combine(stateRoot, stem + ".terminal.json"))) throw new RunnerException(65, "Supervisor durable paths do not match the exact immutable identity.");

        JsonElement argumentsElement = root.GetProperty("arguments");
        if (argumentsElement.ValueKind != JsonValueKind.Array || argumentsElement.GetArrayLength() > MaximumArguments) throw new RunnerException(65, "Request arguments are not bounded.");
        var arguments = new List<string>();
        foreach (JsonElement item in argumentsElement.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String) throw new RunnerException(65, "Request argument must be a string.");
            string value = item.GetString() ?? string.Empty;
            if (value.IndexOf('\0') >= 0 || value.Length > 4096) throw new RunnerException(65, "Request argument is invalid or oversized.");
            arguments.Add(value);
        }
        JsonElement environmentElement = root.GetProperty("environment");
        if (environmentElement.ValueKind != JsonValueKind.Object || environmentElement.EnumerateObject().Count() > MaximumEnvironmentEntries) throw new RunnerException(65, "Request environment is not a bounded object.");
        var environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (JsonProperty entry in environmentElement.EnumerateObject())
        {
            if (!Regex.IsMatch(entry.Name, "^[A-Za-z_][A-Za-z0-9_]{0,127}$", RegexOptions.CultureInvariant) || entry.Value.ValueKind != JsonValueKind.String) throw new RunnerException(65, "Request environment entry is invalid.");
            string value = entry.Value.GetString() ?? string.Empty;
            if (value.IndexOf('\0') >= 0 || value.Length > 8192 || !environment.TryAdd(entry.Name, value)) throw new RunnerException(65, "Request environment entry is invalid or duplicated.");
        }
        return new Request(schema, version, supervisorId, operationId, action, targetSnapshotId, sessionId, authorityId, repositoryRoot, manifestSha256, helperPath, helperSha256, executable, executableSha256, arguments, workingDirectory, environment, lifecycle, timeoutMs, maxOutputBytes, controlToken, statePath, bindingAckPath, terminalPath);
    }

    private static StartedProcess StartSuspendedProcess(string executable, IReadOnlyList<string> arguments, string workingDirectory, IReadOnlyDictionary<string, string> environment, SafeJobHandle job)
    {
        CreatePipe(out IntPtr stdoutRead, out IntPtr stdoutWrite, inheritable: true);
        CreatePipe(out IntPtr stderrRead, out IntPtr stderrWrite, inheritable: true);
        if (!SetHandleInformation(stdoutRead, HandleFlagInherit, 0) || !SetHandleInformation(stderrRead, HandleFlagInherit, 0)) throw LastError(74, "Could not protect supervisor pipe handles.");
        using SafeFileHandle nullInput = CreateFileW("NUL", 0x80000000, 0x00000001 | 0x00000002, IntPtr.Zero, 3, 0x80, IntPtr.Zero);
        if (nullInput.IsInvalid) throw LastError(74, "Could not open the fixed null input handle.");
        if (!SetHandleInformation(nullInput.DangerousGetHandle(), HandleFlagInherit, HandleFlagInherit)) throw LastError(74, "Could not restrict child input inheritance.");
        var startup = new StartupInfoEx
        {
            StartupInfo = new StartupInfo { cb = Marshal.SizeOf<StartupInfoEx>(), dwFlags = StartfUseStdHandles, hStdInput = nullInput.DangerousGetHandle(), hStdOutput = stdoutWrite, hStdError = stderrWrite }
        };
        string commandLine = BuildCommandLine(executable, arguments);
        IntPtr environmentBlock = Marshal.StringToHGlobalUni(BuildEnvironmentBlock(environment, workingDirectory));
        IntPtr attributeListSize = IntPtr.Zero;
        _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeListSize);
        startup.AttributeList = Marshal.AllocHGlobal(attributeListSize);
        IntPtr handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
        IntPtr jobList = Marshal.AllocHGlobal(IntPtr.Size);
        try
        {
            if (!InitializeProcThreadAttributeList(startup.AttributeList, 2, 0, ref attributeListSize)) throw LastError(74, "Could not initialize the restricted process attribute list.");
            Marshal.WriteIntPtr(handleList, 0, nullInput.DangerousGetHandle());
            Marshal.WriteIntPtr(handleList, IntPtr.Size, stdoutWrite);
            Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, stderrWrite);
            if (!UpdateProcThreadAttribute(startup.AttributeList, 0, ProcThreadAttributeHandleList, handleList, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero)) throw LastError(74, "Could not restrict child handle inheritance.");
            Marshal.WriteIntPtr(jobList, job.DangerousGetHandle());
            if (!UpdateProcThreadAttribute(startup.AttributeList, 0, ProcThreadAttributeJobList, jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw LastError(74, "Could not bind the reviewed process to its Job Object at CreateProcess.");
            bool created = CreateProcessW(executable, new StringBuilder(commandLine), IntPtr.Zero, IntPtr.Zero, true, CreateSuspended | CreateNoWindow | CreateUnicodeEnvironment | ExtendedStartupInfoPresent, environmentBlock, workingDirectory, ref startup, out ProcessInformation information);
            int createError = created ? 0 : Marshal.GetLastWin32Error();
            CloseHandle(stdoutWrite);
            CloseHandle(stderrWrite);
            if (!created)
            {
                CloseHandle(stdoutRead);
                CloseHandle(stderrRead);
                throw new RunnerException(74, "Could not create the reviewed process suspended. Win32=" + createError.ToString(CultureInfo.InvariantCulture));
            }
            return new StartedProcess(
                new SafeFileHandle(information.hProcess, true),
                new SafeFileHandle(information.hThread, true),
                checked((int)information.dwProcessId),
                new FileStream(new SafeFileHandle(stdoutRead, true), FileAccess.Read, 4096, false),
                new FileStream(new SafeFileHandle(stderrRead, true), FileAccess.Read, 4096, false));
        }
        finally
        {
            if (startup.AttributeList != IntPtr.Zero) DeleteProcThreadAttributeList(startup.AttributeList);
            Marshal.FreeHGlobal(jobList);
            Marshal.FreeHGlobal(handleList);
            Marshal.FreeHGlobal(startup.AttributeList);
            Marshal.FreeHGlobal(environmentBlock);
        }
    }

    private static SafeJobHandle CreateKillOnCloseJob(string? name)
    {
        SafeJobHandle job = CreateJobObjectW(IntPtr.Zero, name);
        int creationError = Marshal.GetLastWin32Error();
        if (job.IsInvalid) throw new RunnerException(74, "Could not create the owned Windows Job Object. Win32=" + creationError.ToString(CultureInfo.InvariantCulture));
        if (name is not null && creationError == 183)
        {
            job.Dispose();
            throw new RunnerException(73, "The exact repository Job Object name is already owned by another generation.");
        }
        var information = new JobObjectExtendedLimitInformation { BasicLimitInformation = new JobObjectBasicLimitInformation { LimitFlags = JobObjectLimitKillOnJobClose } };
        int size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(information, pointer, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformationClass, pointer, (uint)size)) throw LastError(74, "Could not set Job-Object kill-on-close containment.");
        }
        finally { Marshal.FreeHGlobal(pointer); }
        return job;
    }

    private static uint ActiveProcessCount(SafeJobHandle job)
    {
        int size = Marshal.SizeOf<JobObjectBasicAccountingInformationNative>();
        IntPtr pointer = Marshal.AllocHGlobal(size);
        try
        {
            if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, pointer, (uint)size, IntPtr.Zero)) throw LastError(74, "Could not query the exact Job Object.");
            return Marshal.PtrToStructure<JobObjectBasicAccountingInformationNative>(pointer).ActiveProcesses;
        }
        finally { Marshal.FreeHGlobal(pointer); }
    }

    private static async Task<byte[]> DrainBoundedAsync(Stream stream, SharedOutputBudget budget)
    {
        byte[] buffer = ArrayPool<byte>.Shared.Rent(4096);
        using var captured = new MemoryStream();
        try
        {
            while (true)
            {
                int read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length)).ConfigureAwait(false);
                if (read == 0) break;
                int accepted = budget.Take(read);
                if (accepted > 0) captured.Write(buffer, 0, accepted);
            }
            return captured.ToArray();
        }
        finally { ArrayPool<byte>.Shared.Return(buffer, true); }
    }

    private static async Task<uint> WaitForHandleAsync(SafeFileHandle handle, CancellationToken cancellationToken)
    {
        await Task.Run(() =>
        {
            uint result = WaitForSingleObject(handle, Infinite);
            if (result != WaitObject0) throw LastError(74, "Waiting for the Job-Object child failed.");
        }, cancellationToken).ConfigureAwait(false);
        if (!GetExitCodeProcess(handle, out uint exitCode)) throw LastError(74, "Could not read the Job-Object child exit code.");
        return exitCode;
    }

    private static FileStream OpenVerifiedExecutable(string path, string expectedDigest)
    {
        FileInfo info = new(path);
        if (!info.Exists || (info.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw new RunnerException(65, "Reviewed executable is absent, linked, or not a file.");
        var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        string digest = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        stream.Position = 0;
        if (!FixedEquals(digest, expectedDigest)) { stream.Dispose(); throw new RunnerException(65, "Reviewed executable digest changed before CreateProcess."); }
        return stream;
    }

    private static void VerifyHelperIdentity(Request request)
    {
        string self = ResolveSelf();
        if (!SamePath(self, request.HelperPath) || !FixedEquals(Sha256File(self, 512 * 1024 * 1024), request.HelperSha256)) throw new RunnerException(65, "Helper path or digest does not match the reviewed package identity.");
    }

    private static string ResolveSelf() => Path.GetFullPath(Environment.ProcessPath ?? throw new RunnerException(70, "Helper executable path is unavailable."));
    private static string JobName(string supervisorId) => @"Local\SxsyB122-" + supervisorId["managed:".Length..];

    private static string BuildCommandLine(string executable, IReadOnlyList<string> arguments) => string.Join(" ", new[] { QuoteWindowsArgument(executable) }.Concat(arguments.Select(QuoteWindowsArgument)));
    private static string QuoteWindowsArgument(string value)
    {
        if (value.IndexOf('\0') >= 0) throw new RunnerException(65, "Process argument contains NUL.");
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { result.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            result.Append('\\', slashes).Append(character); slashes = 0;
        }
        result.Append('\\', slashes * 2).Append('"');
        return result.ToString();
    }

    private static string BuildEnvironmentBlock(IReadOnlyDictionary<string, string> environment, string workingDirectory)
    {
        var builder = new StringBuilder();
        string root = Path.GetPathRoot(workingDirectory) ?? string.Empty;
        if (Regex.IsMatch(root, "^[A-Za-z]:\\\\$", RegexOptions.CultureInvariant)) builder.Append('=').Append(char.ToUpperInvariant(root[0])).Append(":=").Append(workingDirectory).Append('\0');
        foreach ((string name, string value) in environment.OrderBy(entry => entry.Key, StringComparer.OrdinalIgnoreCase)) builder.Append(name).Append('=').Append(value).Append('\0');
        if (environment.Count == 0) builder.Append('\0');
        builder.Append('\0');
        return builder.ToString();
    }

    private static async Task<bool> WaitUntilAsync(Func<bool> predicate, int timeoutMs)
    {
        DateTime deadline = DateTime.UtcNow.AddMilliseconds(timeoutMs);
        do { if (predicate()) return true; await Task.Delay(20).ConfigureAwait(false); } while (DateTime.UtcNow < deadline);
        return predicate();
    }

    private static bool IsProcessAlive(int pid)
    {
        if (pid <= 0) return false;
        using SafeFileHandle handle = OpenProcess(Synchronize, false, (uint)pid);
        return !handle.IsInvalid && WaitForSingleObject(handle, 0) != WaitObject0;
    }

    private static byte[] ReadBoundedFile(string path, int maximumBytes, string label)
    {
        FileInfo info = new(path);
        if (!info.Exists || info.Length <= 0 || info.Length > maximumBytes || (info.Attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw new RunnerException(65, $"{label} is absent, linked, empty, or oversized.");
        return File.ReadAllBytes(info.FullName);
    }

    private static JsonElement ExactObject(JsonElement value, IReadOnlyCollection<string> expected, string label)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new RunnerException(65, $"{label} must be an object.");
        string[] actual = value.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal).ToArray();
        string[] required = expected.OrderBy(name => name, StringComparer.Ordinal).ToArray();
        if (!actual.SequenceEqual(required, StringComparer.Ordinal)) throw new RunnerException(65, $"{label} does not use the exact v1 schema.");
        return value;
    }

    private static string RequiredString(JsonElement root, string name, int maximumCharacters)
    {
        JsonElement value = root.GetProperty(name);
        if (value.ValueKind != JsonValueKind.String) throw new RunnerException(65, $"{name} must be a string.");
        string text = value.GetString() ?? string.Empty;
        if (text.Length == 0 || text.Length > maximumCharacters || text.IndexOf('\0') >= 0 || text.IndexOfAny(new[] { '\r', '\n' }) >= 0) throw new RunnerException(65, $"{name} is invalid or oversized.");
        return text;
    }

    private static string? OptionalIdentifier(JsonElement root, string name)
    {
        JsonElement element = root.GetProperty(name);
        if (element.ValueKind == JsonValueKind.Null) return null;
        if (element.ValueKind != JsonValueKind.String) throw new RunnerException(65, $"{name} must be null or an exact identifier.");
        string value = element.GetString() ?? string.Empty;
        if (value.Length < 1 || value.Length > 256 || value.IndexOf('\0') >= 0 || value.IndexOfAny(new[] { '\r', '\n' }) >= 0) throw new RunnerException(65, $"{name} is invalid.");
        return value;
    }

    private static string RequiredDigest(JsonElement root, string name)
    {
        string value = RequiredString(root, name, 64).ToLowerInvariant();
        if (!SafeDigest.IsMatch(value)) throw new RunnerException(65, $"{name} is not a SHA-256 digest.");
        return value;
    }

    private static int RequiredInt(JsonElement root, string name, int minimum, int maximum)
    {
        if (!root.GetProperty(name).TryGetInt32(out int value) || value < minimum || value > maximum) throw new RunnerException(65, $"{name} is outside its bound.");
        return value;
    }

    private static string RequireAbsolutePath(string value, string label)
    {
        if (!Path.IsPathFullyQualified(value) || value.IndexOf('\0') >= 0) throw new RunnerException(64, $"{label} must be an absolute path.");
        return Path.GetFullPath(value);
    }

    private static bool Inside(string child, string root)
    {
        string relative = Path.GetRelativePath(root, child);
        return relative == "." || (!relative.Equals("..", StringComparison.Ordinal) && !relative.StartsWith(".." + Path.DirectorySeparatorChar, StringComparison.Ordinal) && !Path.IsPathFullyQualified(relative));
    }

    private static bool SamePath(string left, string right) => StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'));
    private static bool FixedEquals(string left, string right) => left.Length == right.Length && CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(left), Encoding.ASCII.GetBytes(right));
    private static string Sha256Text(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    private static string Sha256Bytes(byte[] value) => Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
    private static string Sha256File(string path, int maximumBytes) => Convert.ToHexString(SHA256.HashData(ReadBoundedFile(path, maximumBytes, "file"))).ToLowerInvariant();
    private static int ParseBound(string value, int minimum, int maximum) => int.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out int parsed) && parsed >= minimum && parsed <= maximum ? parsed : throw new RunnerException(64, "Termination bound is invalid.");

    private static void WriteStateNew(string path, SupervisorState state)
    {
        if (File.Exists(path)) throw new RunnerException(73, "Supervisor state already exists.");
        AtomicWrite(path, state, overwrite: false);
    }
    private static void WriteStateReplace(string path, SupervisorState state) => AtomicWrite(path, state, overwrite: true);
    private static void AtomicWrite(string path, SupervisorState state, bool overwrite)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new RunnerException(65, "State directory is absent."));
        string temporary = path + "." + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture) + ".tmp";
        File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(state, JsonOptions));
        try { File.Move(temporary, path, overwrite); }
        catch { try { File.Delete(temporary); } catch (IOException) { } throw; }
    }

    private static async Task WaitForBindingAckAsync(string path, string expectedRequestDigest, int timeoutMs)
    {
        DateTimeOffset deadline = DateTimeOffset.UtcNow.AddMilliseconds(timeoutMs);
        while (DateTimeOffset.UtcNow < deadline)
        {
            if (File.Exists(path))
            {
                string observed = Encoding.ASCII.GetString(ReadBoundedFile(path, 256, "binding acknowledgement")).Trim();
                if (!FixedEquals(observed, expectedRequestDigest)) throw new RunnerException(65, "Host binding acknowledgement does not match the immutable request digest.");
                return;
            }
            await Task.Delay(25).ConfigureAwait(false);
        }
        throw new RunnerException(75, "The host did not authenticate the immutable supervisor binding before the child-release deadline.");
    }

    private static TerminalReceipt CreateTerminalReceipt(
        Request request,
        string requestSha256,
        string signingPublicKeySha256,
        string startedAt,
        string finishedAt,
        string state,
        int exitCode,
        bool outputTruncated,
        ECDsa signer)
    {
        var unsigned = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["action"] = request.Action,
            ["authorityId"] = request.AuthorityId,
            ["effectDisposition"] = "committed",
            ["exitCode"] = exitCode,
            ["finishedAt"] = finishedAt,
            ["helperSha256"] = request.HelperSha256,
            ["manifestSha256"] = request.ManifestSha256,
            ["operationId"] = request.OperationId,
            ["outputTruncated"] = outputTruncated,
            ["repositoryRoot"] = request.RepositoryRoot,
            ["requestSha256"] = requestSha256,
            ["schema"] = TerminalSchema,
            ["sessionId"] = request.SessionId,
            ["signingPublicKeySha256"] = signingPublicKeySha256,
            ["startedAt"] = startedAt,
            ["state"] = state,
            ["supervisorId"] = request.SupervisorId,
            ["targetSnapshotId"] = request.TargetSnapshotId,
            ["version"] = 1
        };
        byte[] canonical = JsonSerializer.SerializeToUtf8Bytes(unsigned, CanonicalJsonOptions);
        string signature = Convert.ToBase64String(signer.SignData(canonical, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence));
        return new TerminalReceipt(TerminalSchema, 1, request.SupervisorId, request.OperationId, request.Action, request.TargetSnapshotId,
            request.SessionId, request.AuthorityId, request.RepositoryRoot, request.ManifestSha256, request.HelperSha256, requestSha256,
            signingPublicKeySha256, startedAt, finishedAt, state, exitCode, outputTruncated, "committed", signature);
    }

    private static int VerifyTerminal(string terminalArgument, string signingPublicKeySpki, string expectedSigningPublicKeySha256)
    {
        string terminalPath = RequireAbsolutePath(terminalArgument, "terminal receipt");
        byte[] bytes = ReadBoundedFile(terminalPath, MaximumDocumentBytes, "terminal receipt");
        using JsonDocument document = JsonDocument.Parse(bytes, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 16 });
        ExactObject(document.RootElement, new[] { "schema", "version", "supervisorId", "operationId", "action", "targetSnapshotId", "sessionId", "authorityId", "repositoryRoot", "manifestSha256", "helperSha256", "requestSha256", "signingPublicKeySha256", "startedAt", "finishedAt", "state", "exitCode", "outputTruncated", "effectDisposition", "signature" }, "terminal receipt");
        TerminalReceipt receipt = JsonSerializer.Deserialize<TerminalReceipt>(bytes, JsonOptions) ?? throw new RunnerException(65, "Terminal receipt is malformed.");
        byte[] publicKeyBytes;
        byte[] signature;
        try { publicKeyBytes = Convert.FromBase64String(signingPublicKeySpki); signature = Convert.FromBase64String(receipt.Signature); }
        catch (FormatException) { throw new RunnerException(65, "Terminal signature material is malformed."); }
        if (!SafeDigest.IsMatch(expectedSigningPublicKeySha256)
            || !FixedEquals(Sha256Bytes(publicKeyBytes), expectedSigningPublicKeySha256.ToLowerInvariant())
            || !FixedEquals(receipt.SigningPublicKeySha256, expectedSigningPublicKeySha256.ToLowerInvariant())) throw new RunnerException(65, "Terminal signing key identity changed.");
        var unsigned = new SortedDictionary<string, object?>(StringComparer.Ordinal)
        {
            ["action"] = receipt.Action,
            ["authorityId"] = receipt.AuthorityId,
            ["effectDisposition"] = receipt.EffectDisposition,
            ["exitCode"] = receipt.ExitCode,
            ["finishedAt"] = receipt.FinishedAt,
            ["helperSha256"] = receipt.HelperSha256,
            ["manifestSha256"] = receipt.ManifestSha256,
            ["operationId"] = receipt.OperationId,
            ["outputTruncated"] = receipt.OutputTruncated,
            ["repositoryRoot"] = receipt.RepositoryRoot,
            ["requestSha256"] = receipt.RequestSha256,
            ["schema"] = receipt.Schema,
            ["sessionId"] = receipt.SessionId,
            ["signingPublicKeySha256"] = receipt.SigningPublicKeySha256,
            ["startedAt"] = receipt.StartedAt,
            ["state"] = receipt.State,
            ["supervisorId"] = receipt.SupervisorId,
            ["targetSnapshotId"] = receipt.TargetSnapshotId,
            ["version"] = receipt.Version
        };
        using ECDsa verifier = ECDsa.Create();
        verifier.ImportSubjectPublicKeyInfo(publicKeyBytes, out int consumed);
        if (consumed != publicKeyBytes.Length || !verifier.VerifyData(JsonSerializer.SerializeToUtf8Bytes(unsigned, CanonicalJsonOptions), signature, HashAlgorithmName.SHA256, DSASignatureFormat.Rfc3279DerSequence)) throw new RunnerException(65, "Terminal receipt signature is invalid.");
        return 0;
    }

    private static void WriteTerminalNew(string path, TerminalReceipt receipt)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new RunnerException(65, "Terminal receipt directory is absent."));
        string temporary = path + "." + Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture) + ".tmp";
        File.WriteAllBytes(temporary, JsonSerializer.SerializeToUtf8Bytes(receipt, JsonOptions));
        try { File.Move(temporary, path, false); }
        catch { try { File.Delete(temporary); } catch (IOException) { } throw; }
    }

    private static RunnerException LastError(int exitCode, string message) => new(exitCode, message + " Win32=" + Marshal.GetLastWin32Error().ToString(CultureInfo.InvariantCulture));
    private static void Diagnostic(string message) => Console.Error.WriteLine(message);
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = false, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
    private static readonly JsonSerializerOptions CanonicalJsonOptions = new() { WriteIndented = false, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private sealed record Request(string Schema, int Version, string SupervisorId, string OperationId, string Action, string TargetSnapshotId, string? SessionId, string? AuthorityId, string RepositoryRoot, string ManifestSha256, string HelperPath, string HelperSha256, string Executable, string ExecutableSha256, IReadOnlyList<string> Arguments, string WorkingDirectory, IReadOnlyDictionary<string, string> Environment, string Lifecycle, int TimeoutMs, int MaxOutputBytes, string ControlToken, string StatePath, string BindingAckPath, string TerminalPath);
    private sealed record SupervisorState(string Schema, int Version, string SupervisorId, string OperationId, string Action, string TargetSnapshotId, string? SessionId, string? AuthorityId, string RepositoryRoot, string ManifestSha256, string HelperPath, string HelperSha256, string RequestSha256, string SigningPublicKeySpki, string SigningPublicKeySha256, string JobName, int SupervisorPid, int ChildPid, string StartedAt, string State, int? ExitCode, bool OutputTruncated);
    private sealed record TerminalReceipt(string Schema, int Version, string SupervisorId, string OperationId, string Action, string TargetSnapshotId, string? SessionId, string? AuthorityId, string RepositoryRoot, string ManifestSha256, string HelperSha256, string RequestSha256, string SigningPublicKeySha256, string StartedAt, string FinishedAt, string State, int ExitCode, bool OutputTruncated, string EffectDisposition, string Signature);
    private sealed record TypedRecipe(string Executable, string ExecutableSha256, IReadOnlyList<string> Arguments, string WorkingDirectory, IReadOnlyDictionary<string, string> Environment, int TimeoutMs, int MaxOutputBytes, IReadOnlyList<CoverageItem> Coverage, IReadOnlyList<string> ScannerFixtureIds, IReadOnlyList<string> AdvisoryFixtureIds);
    private sealed record CoverageItem(string Dimension, string FixtureId);
    private sealed class RunnerException : Exception { public RunnerException(int exitCode, string message) : base(message) { ExitCode = exitCode; } public int ExitCode { get; } }
    private sealed class DirectoryLockSet : IDisposable
    {
        private readonly IReadOnlyList<SafeFileHandle> handles;
        public DirectoryLockSet(IReadOnlyList<SafeFileHandle> handles) { this.handles = handles; }
        public void Dispose() { foreach (SafeFileHandle handle in handles.Reverse()) handle.Dispose(); }
    }
    private sealed class SharedOutputBudget
    {
        private readonly int limit; private int accepted;
        public SharedOutputBudget(int limit) { this.limit = limit; }
        public bool Truncated { get; private set; }
        public int Take(int count) { lock (this) { int remaining = limit - accepted; int take = Math.Max(0, Math.Min(remaining, count)); accepted += take; if (take < count) Truncated = true; return take; } }
    }
    private sealed class StartedProcess : IDisposable
    {
        public StartedProcess(SafeFileHandle processHandle, SafeFileHandle threadHandle, int processId, FileStream standardOutput, FileStream standardError) { ProcessHandle = processHandle; ThreadHandle = threadHandle; ProcessId = processId; StandardOutput = standardOutput; StandardError = standardError; }
        public SafeFileHandle ProcessHandle { get; }
        public SafeFileHandle ThreadHandle { get; }
        public int ProcessId { get; }
        public FileStream StandardOutput { get; }
        public FileStream StandardError { get; }
        public void Dispose() { StandardOutput.Dispose(); StandardError.Dispose(); ThreadHandle.Dispose(); ProcessHandle.Dispose(); }
    }

    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo { public int cb; public string? lpReserved; public string? lpDesktop; public string? lpTitle; public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize; public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute; public uint dwFlags; public ushort wShowWindow; public ushort cbReserved2; public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError; }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo StartupInfo; public IntPtr AttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JobObjectBasicLimitInformation { public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
    [StructLayout(LayoutKind.Sequential)] private struct JobObjectExtendedLimitInformation { public JobObjectBasicLimitInformation BasicLimitInformation; public IoCounters IoInfo; public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed; }
    [StructLayout(LayoutKind.Sequential)] private struct JobObjectBasicAccountingInformationNative { public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime; public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses; }

    private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid { private SafeJobHandle() : base(true) { } protected override bool ReleaseHandle() => CloseHandle(handle); }

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeJobHandle CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeJobHandle OpenJobObject(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(SafeJobHandle job, int informationClass, IntPtr information, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(SafeJobHandle job, int informationClass, IntPtr information, uint length, IntPtr returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(SafeJobHandle job, SafeFileHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsProcessInJob(SafeFileHandle process, SafeJobHandle job, [MarshalAs(UnmanagedType.Bool)] out bool result);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfoEx startupInfo, out ProcessInformation processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr attributeList, int attributeCount, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr attributeList, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeHandle handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string path, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint characters, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreatePipe(out IntPtr readPipe, out IntPtr writePipe, ref SecurityAttributes attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);

    private static void CreatePipe(out IntPtr read, out IntPtr write, bool inheritable)
    {
        var attributes = new SecurityAttributes { nLength = Marshal.SizeOf<SecurityAttributes>(), bInheritHandle = inheritable };
        if (!CreatePipe(out read, out write, ref attributes, 0)) throw LastError(74, "Could not create a bounded output pipe.");
    }
}
