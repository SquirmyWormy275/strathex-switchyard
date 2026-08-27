using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Sxsy.B122.SandboxLifecycleHelper;

internal static class Program
{
    private const string RequestSchema = "sxsy-b122.sandbox-lifecycle-request";
    private const string ResponseSchema = "sxsy-b122.sandbox-lifecycle-response";
    private const string SandboxExecutable = "C:\\Windows\\System32\\WindowsSandbox.exe";
    private const int MaximumRequestCharacters = 16 * 1024;
    private const uint PROCESS_TERMINATE = 0x0001;
    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint SYNCHRONIZE = 0x00100000;
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;
    private const uint FILE_READ_ATTRIBUTES = 0x00000080;
    private const uint FILE_SHARE_READ = 0x00000001;
    private const uint FILE_SHARE_WRITE = 0x00000002;
    private const uint FILE_SHARE_DELETE = 0x00000004;
    private const uint OPEN_EXISTING = 3;
    private const uint STILL_ACTIVE = 259;
    private const uint WAIT_OBJECT_0 = 0;
    private const uint GW_OWNER = 4;
    private const int SW_RESTORE = 9;

    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
        if (args.Length != 1 || args[0] != "--stdio-v1") return 64;
        string requestId = "unknown";
        try
        {
            if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
            Request request = ParseRequest(ReadBoundedLine());
            requestId = request.RequestId;
            return request.Action switch
            {
                "launch" => Launch(request),
                "inspect" => Inspect(request),
                "focus" => Focus(request),
                "terminate" => Terminate(request),
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
        var identity = new ProcessIdentity(42, 133801632000000000UL, SandboxExecutable, 123, 456, 1);
        bool identityChecks = SameIdentity(identity, identity)
            && !SameIdentity(identity, identity with { CreationFileTimeUtc = identity.CreationFileTimeUtc + 1 });
        bool quoting = QuoteArgument(@"C:\state root\sandbox.wsb") == "\"C:\\state root\\sandbox.wsb\"";
        bool digest = IsDigest(new string('a', 64)) && !IsDigest(new string('g', 64));
        bool success = identityChecks && quoting && digest;
        Write(new { schema = "sxsy-b122.sandbox-lifecycle-self-test", version = 1, status = success ? "ok" : "failed", hardwareAccessed = false });
        return success ? 0 : 1;
    }

    private static int Launch(Request request)
    {
        if (request.ConfigurationPath is null || request.ConfigurationSha256 is null) throw new ProtocolException("invalid_launch_request");
        string configurationPath = CanonicalConfiguration(request.ConfigurationPath, request.ConfigurationSha256);
        var startup = new StartupInfo { Cb = Marshal.SizeOf<StartupInfo>() };
        string commandLine = $"{QuoteArgument(SandboxExecutable)} {QuoteArgument(configurationPath)}";
        if (!CreateProcessW(
            SandboxExecutable,
            new StringBuilder(commandLine),
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            CREATE_SUSPENDED | CREATE_NEW_PROCESS_GROUP,
            IntPtr.Zero,
            @"C:\Windows\System32",
            ref startup,
            out ProcessInformation processInformation)) throw NativeFailure("sandbox_launch_failed");
        using var process = new SafeFileHandle(processInformation.Process, ownsHandle: true);
        using var thread = new SafeFileHandle(processInformation.Thread, ownsHandle: true);
        bool resumed = false;
        try
        {
            ProcessIdentity identity = CaptureExactIdentity(process, processInformation.ProcessId);
            RequireSandboxExecutable(identity);
            CanonicalConfiguration(configurationPath, request.ConfigurationSha256);
            if (ResumeThread(thread) == uint.MaxValue) throw NativeFailure("sandbox_resume_failed");
            resumed = true;
            WriteResult(request.RequestId, "launched", identity);
            return 0;
        }
        catch
        {
            if (!resumed) _ = TerminateProcess(process, 70);
            throw;
        }
    }

    private static int Inspect(Request request)
    {
        ProcessIdentity expected = request.Identity ?? throw new ProtocolException("missing_process_identity");
        try
        {
            using SafeFileHandle process = OpenExactProcess(expected.Pid, PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE);
            if (!IsActive(process))
            {
                Write(new { schema = ResponseSchema, version = 1, requestId = request.RequestId, kind = "result", status = "absent" });
                return 0;
            }
            ProcessIdentity observed = CaptureExactIdentity(process, expected.Pid);
            Write(new { schema = ResponseSchema, version = 1, requestId = request.RequestId, kind = "result", status = SameIdentity(observed, expected) ? "same" : "mismatch" });
            return 0;
        }
        catch (ProcessAbsentException)
        {
            Write(new { schema = ResponseSchema, version = 1, requestId = request.RequestId, kind = "result", status = "absent" });
            return 0;
        }
    }

    private static int Focus(Request request)
    {
        ProcessIdentity expected = request.Identity ?? throw new ProtocolException("missing_process_identity");
        using SafeFileHandle process = OpenExactProcess(expected.Pid, PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE);
        ProcessIdentity before = CaptureExactIdentity(process, expected.Pid);
        if (!SameIdentity(before, expected)) throw new ProtocolException("process_identity_mismatch");
        IntPtr window = FindExactWindow(expected.Pid);
        ProcessIdentity final = CaptureExactIdentity(process, expected.Pid);
        if (!SameIdentity(final, expected)) throw new ProtocolException("process_identity_changed");
        _ = ShowWindow(window, SW_RESTORE);
        if (!SetForegroundWindow(window)) throw new ProtocolException("focus_denied");
        if (GetWindowThreadProcessId(window, out uint finalWindowPid) == 0 || finalWindowPid != expected.Pid) throw new ProtocolException("window_identity_changed");
        ProcessIdentity after = CaptureExactIdentity(process, expected.Pid);
        if (!SameIdentity(after, expected)) throw new ProtocolException("process_identity_changed");
        WriteResult(request.RequestId, "focused", after);
        return 0;
    }

    private static int Terminate(Request request)
    {
        ProcessIdentity expected = request.Identity ?? throw new ProtocolException("missing_process_identity");
        using SafeFileHandle process = OpenExactProcess(expected.Pid, PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_TERMINATE | SYNCHRONIZE);
        ProcessIdentity before = CaptureExactIdentity(process, expected.Pid);
        if (!SameIdentity(before, expected)) throw new ProtocolException("process_identity_mismatch");
        ProcessIdentity final = CaptureExactIdentity(process, expected.Pid);
        if (!SameIdentity(final, expected)) throw new ProtocolException("process_identity_changed");
        if (!TerminateProcess(process, 0)) throw NativeFailure("sandbox_termination_failed");
        if (WaitForSingleObject(process, 10_000) != WAIT_OBJECT_0) throw NativeFailure("sandbox_termination_unverified");
        WriteResult(request.RequestId, "terminated", before);
        return 0;
    }

    private static ProcessIdentity CaptureExactIdentity(SafeFileHandle process, uint pid)
    {
        if (!GetExitCodeProcess(process, out uint exitCode) || exitCode != STILL_ACTIVE) throw new ProcessAbsentException();
        var path = new StringBuilder(4096);
        uint pathLength = (uint)path.Capacity;
        if (!QueryFullProcessImageNameW(process, 0, path, ref pathLength) || pathLength == 0) throw NativeFailure("process_image_unavailable");
        string executablePath = Path.GetFullPath(path.ToString());
        if (!GetProcessTimes(process, out FileTime creation, out _, out _, out _)) throw NativeFailure("process_creation_time_unavailable");
        if (!ProcessIdToSessionId(pid, out uint sessionId)) throw NativeFailure("process_session_unavailable");
        using SafeFileHandle executable = CreateFileW(
            executablePath,
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            IntPtr.Zero,
            OPEN_EXISTING,
            0,
            IntPtr.Zero);
        if (executable.IsInvalid || !GetFileInformationByHandle(executable, out ByHandleFileInformation information)) throw NativeFailure("process_image_identity_unavailable");
        ulong creationValue = ((ulong)creation.HighDateTime << 32) | creation.LowDateTime;
        ulong fileIndex = ((ulong)information.FileIndexHigh << 32) | information.FileIndexLow;
        return new ProcessIdentity(pid, creationValue, executablePath, information.VolumeSerialNumber, fileIndex, sessionId);
    }

    private static void RequireSandboxExecutable(ProcessIdentity identity)
    {
        if (!SamePath(identity.ExecutablePath, SandboxExecutable)) throw new ProtocolException("unexpected_process_image");
    }

    private static SafeFileHandle OpenExactProcess(uint pid, uint access)
    {
        if (pid == 0) throw new ProtocolException("invalid_process_identity");
        SafeFileHandle handle = OpenProcess(access, false, pid);
        if (!handle.IsInvalid) return handle;
        int error = Marshal.GetLastWin32Error();
        handle.Dispose();
        if (error is 87 or 1168) throw new ProcessAbsentException();
        throw NativeFailure("process_open_failed", error);
    }

    private static bool IsActive(SafeFileHandle process)
    {
        if (!GetExitCodeProcess(process, out uint exitCode)) throw NativeFailure("process_state_unavailable");
        return exitCode == STILL_ACTIVE;
    }

    private static IntPtr FindExactWindow(uint pid)
    {
        var windows = new List<IntPtr>();
        EnumWindows((window, _) =>
        {
            if (IsWindowVisible(window) && GetWindow(window, GW_OWNER) == IntPtr.Zero
                && GetWindowThreadProcessId(window, out uint windowPid) != 0 && windowPid == pid) windows.Add(window);
            return true;
        }, IntPtr.Zero);
        if (windows.Count == 0) throw new ProtocolException("sandbox_window_unavailable");
        if (windows.Count != 1) throw new ProtocolException("sandbox_window_ambiguous");
        return windows[0];
    }

    private static string CanonicalConfiguration(string input, string expectedSha256)
    {
        if (!Path.IsPathFullyQualified(input) || input.Length > 4096 || input.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0
            || !Path.GetExtension(input).Equals(".wsb", StringComparison.OrdinalIgnoreCase) || !IsDigest(expectedSha256)) throw new ProtocolException("invalid_configuration");
        string canonical = Path.GetFullPath(input);
        FileAttributes attributes = File.GetAttributes(canonical);
        if ((attributes & (FileAttributes.Directory | FileAttributes.ReparsePoint)) != 0) throw new ProtocolException("invalid_configuration_file");
        using var stream = new FileStream(canonical, FileMode.Open, FileAccess.Read, FileShare.Read);
        if (stream.Length is <= 0 or > 1024 * 1024) throw new ProtocolException("invalid_configuration_size");
        string actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(actual), Encoding.ASCII.GetBytes(expectedSha256.ToLowerInvariant()))) throw new ProtocolException("configuration_changed");
        return canonical;
    }

    private static Request ParseRequest(string input)
    {
        using JsonDocument document = JsonDocument.Parse(input, new JsonDocumentOptions { AllowTrailingCommas = false, CommentHandling = JsonCommentHandling.Disallow, MaxDepth = 8 });
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw new ProtocolException("invalid_request");
        string action = RequiredText(root, "action", 32);
        string[] expected = action == "launch"
            ? new[] { "schema", "version", "requestId", "action", "configurationPath", "configurationSha256" }
            : new[] { "schema", "version", "requestId", "action", "identity" };
        RequireExactProperties(root, expected);
        if (RequiredText(root, "schema", 80) != RequestSchema || RequiredInteger(root, "version") != 1) throw new ProtocolException("invalid_schema");
        string requestId = RequiredText(root, "requestId", 128);
        if (requestId.Length < 24 || !requestId.All(character => char.IsAsciiLetterOrDigit(character) || character is ':' or '-')) throw new ProtocolException("invalid_request_id");
        if (action == "launch") return new Request(requestId, action, null, RequiredText(root, "configurationPath", 4096), RequiredText(root, "configurationSha256", 64));
        if (action is not ("inspect" or "focus" or "terminate")) throw new ProtocolException("invalid_action");
        return new Request(requestId, action, ParseIdentity(root.GetProperty("identity")), null, null);
    }

    private static ProcessIdentity ParseIdentity(JsonElement value)
    {
        RequireExactProperties(value, "pid", "creationFileTimeUtc", "executablePath", "executableVolumeSerialNumber", "executableFileIndex", "sessionId");
        uint pid = RequiredUnsignedInteger(value, "pid");
        ulong created = RequiredUnsignedDecimal(value, "creationFileTimeUtc");
        string executablePath = RequiredText(value, "executablePath", 4096);
        ulong volume = RequiredUnsignedDecimal(value, "executableVolumeSerialNumber");
        ulong index = RequiredUnsignedDecimal(value, "executableFileIndex");
        uint session = RequiredUnsignedInteger(value, "sessionId");
        var identity = new ProcessIdentity(pid, created, executablePath, volume, index, session);
        RequireSandboxExecutable(identity);
        return identity;
    }

    private static bool SameIdentity(ProcessIdentity left, ProcessIdentity right)
    {
        return left.Pid == right.Pid && left.CreationFileTimeUtc == right.CreationFileTimeUtc
            && SamePath(left.ExecutablePath, right.ExecutablePath)
            && left.ExecutableVolumeSerialNumber == right.ExecutableVolumeSerialNumber
            && left.ExecutableFileIndex == right.ExecutableFileIndex && left.SessionId == right.SessionId;
    }

    private static bool SamePath(string left, string right)
    {
        return string.Equals(Path.GetFullPath(left).TrimEnd('\\'), Path.GetFullPath(right).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);
    }

    private static string QuoteArgument(string value)
    {
        if (value.IndexOfAny(new[] { '\0', '\r', '\n', '\"' }) >= 0) throw new ProtocolException("invalid_argument");
        return $"\"{value}\"";
    }

    private static string ReadBoundedLine()
    {
        string? line = Console.In.ReadLine();
        if (line is null || line.Length == 0 || line.Length > MaximumRequestCharacters || Console.In.Read() != -1) throw new ProtocolException("invalid_request_size");
        return line;
    }

    private static void RequireExactProperties(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new ProtocolException("invalid_object");
        string[] actual = value.EnumerateObject().Select(property => property.Name).OrderBy(name => name, StringComparer.Ordinal).ToArray();
        string[] expected = names.OrderBy(name => name, StringComparer.Ordinal).ToArray();
        if (!actual.SequenceEqual(expected, StringComparer.Ordinal)) throw new ProtocolException("invalid_properties");
    }

    private static string RequiredText(JsonElement value, string property, int maximum)
    {
        if (!value.TryGetProperty(property, out JsonElement element) || element.ValueKind != JsonValueKind.String) throw new ProtocolException("invalid_text");
        string result = element.GetString() ?? "";
        if (result.Length == 0 || result.Length > maximum || result.IndexOfAny(new[] { '\0', '\r', '\n' }) >= 0) throw new ProtocolException("invalid_text");
        return result;
    }

    private static int RequiredInteger(JsonElement value, string property)
    {
        if (!value.TryGetProperty(property, out JsonElement element) || !element.TryGetInt32(out int result)) throw new ProtocolException("invalid_integer");
        return result;
    }

    private static uint RequiredUnsignedInteger(JsonElement value, string property)
    {
        if (!value.TryGetProperty(property, out JsonElement element) || !element.TryGetUInt32(out uint result)) throw new ProtocolException("invalid_integer");
        return result;
    }

    private static ulong RequiredUnsignedDecimal(JsonElement value, string property)
    {
        string text = RequiredText(value, property, 20);
        if ((text.Length > 1 && text[0] == '0') || !ulong.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out ulong result)) throw new ProtocolException("invalid_unsigned_identity");
        return result;
    }

    private static bool IsDigest(string value)
    {
        return value.Length == 64 && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f' or >= 'A' and <= 'F');
    }

    private static void WriteResult(string requestId, string effect, ProcessIdentity identity)
    {
        Write(new
        {
            schema = ResponseSchema,
            version = 1,
            requestId,
            kind = "result",
            effect,
            identity = new
            {
                pid = identity.Pid,
                creationFileTimeUtc = identity.CreationFileTimeUtc.ToString(CultureInfo.InvariantCulture),
                executablePath = identity.ExecutablePath,
                executableVolumeSerialNumber = identity.ExecutableVolumeSerialNumber.ToString(CultureInfo.InvariantCulture),
                executableFileIndex = identity.ExecutableFileIndex.ToString(CultureInfo.InvariantCulture),
                sessionId = identity.SessionId
            }
        });
    }

    private static void Write(object value)
    {
        Console.Out.WriteLine(JsonSerializer.Serialize(value));
    }

    private static ProtocolException NativeFailure(string code, int? error = null)
    {
        return new ProtocolException(error is null ? code : $"{code}_{error.Value}");
    }

    private sealed class ProtocolException : Exception
    {
        public string Code { get; }
        public ProtocolException(string code) : base(code) { Code = code; }
    }

    private sealed class ProcessAbsentException : Exception { }

    private sealed record Request(string RequestId, string Action, ProcessIdentity? Identity, string? ConfigurationPath, string? ConfigurationSha256);
    private sealed record ProcessIdentity(uint Pid, ulong CreationFileTimeUtc, string ExecutablePath, ulong ExecutableVolumeSerialNumber, ulong ExecutableFileIndex, uint SessionId);

    [StructLayout(LayoutKind.Sequential)]
    private struct StartupInfo
    {
        public int Cb;
        public IntPtr Reserved;
        public IntPtr Desktop;
        public IntPtr Title;
        public uint X;
        public uint Y;
        public uint XSize;
        public uint YSize;
        public uint XCountChars;
        public uint YCountChars;
        public uint FillAttribute;
        public uint Flags;
        public ushort ShowWindow;
        public ushort Reserved2;
        public IntPtr Reserved2Pointer;
        public IntPtr StdInput;
        public IntPtr StdOutput;
        public IntPtr StdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr Process;
        public IntPtr Thread;
        public uint ProcessId;
        public uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct FileTime
    {
        public uint LowDateTime;
        public uint HighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public FileTime CreationTime;
        public FileTime LastAccessTime;
        public FileTime LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr parameter);

    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle OpenProcess(uint desiredAccess, [MarshalAs(UnmanagedType.Bool)] bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryFullProcessImageNameW(SafeFileHandle process, uint flags, StringBuilder executableName, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetProcessTimes(SafeFileHandle process, out FileTime creation, out FileTime exit, out FileTime kernel, out FileTime user);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(SafeFileHandle process, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFileW(string fileName, uint desiredAccess, uint shareMode, IntPtr securityAttributes, uint creationDisposition, uint flagsAndAttributes, IntPtr templateFile);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetFileInformationByHandle(SafeFileHandle file, out ByHandleFileInformation information);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(SafeFileHandle process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll", SetLastError = true)] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetForegroundWindow(IntPtr window);
}
