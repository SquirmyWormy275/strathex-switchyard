using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

// Default mode: current-user closed hotkey intents, with no shell or input injection.
// The separate private runtime guardian mode is used only by the native installer.
internal static class Program
{
    private const uint WmHotkey = 0x0312, WmControl = 0x8001, WmQuit = 0x0012;
    private static readonly ConcurrentQueue<JsonElement> Requests = new();
    private static readonly Dictionary<int, Binding> Bindings = new();
    private static readonly object OutputLock = new();
    private static readonly HttpClient Client = new(new HttpClientHandler { UseProxy = false, AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(30) };
    private static readonly HashSet<string> Intents = new() { "summon", "resume", "review", "handoff", "status", "cancel" };
    private static Uri? Origin;
    private static string Token = "";
    private static bool ReadOnly;
    private sealed record Binding(int Id, uint Modifiers, uint VirtualKey, string Body);
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct Message { public IntPtr Hwnd; public uint Id; public UIntPtr WParam; public IntPtr LParam; public uint Time; public Point Point; public uint Private; }
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool RegisterHotKey(IntPtr window, int id, uint modifiers, uint virtualKey);
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UnregisterHotKey(IntPtr window, int id);
    [DllImport("user32.dll")] private static extern int GetMessageW(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PeekMessageW(out Message message, IntPtr window, uint min, uint max, uint remove);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostThreadMessageW(uint thread, uint message, UIntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
    [DllImport("user32.dll")] private static extern IntPtr GetKeyboardLayout(uint thread);

    private static void Write(object message) { lock (OutputLock) Console.WriteLine(JsonSerializer.Serialize(message)); }
    private static void Handle(JsonElement request)
    {
        var id = request.GetProperty("id").GetInt32();
        try
        {
            switch (request.GetProperty("method").GetString())
            {
                case "register":
                    if (ReadOnly) throw new InvalidOperationException("This helper session permits category observation only");
                    var keyId = request.GetProperty("bindingId").GetInt32();
                    var modifiers = request.GetProperty("modifiers").GetUInt32();
                    var virtualKey = request.GetProperty("virtualKey").GetUInt32();
                    var body = request.GetProperty("body");
                    if (keyId < 1 || keyId > 1024 || Bindings.ContainsKey(keyId) || (modifiers & 8) == 0 || (modifiers & 7) == 0 || (modifiers & ~15U) != 0 || !(virtualKey is >= 48 and <= 57 or >= 65 and <= 90 or >= 112 and <= 135)) throw new InvalidOperationException("Unsupported bounded hotkey");
                    var implementation = body.GetProperty("implementation").GetString();
                    if (implementation != "switchyard.role/v1" && implementation != "native-chatgpt.focus/v1") throw new InvalidOperationException("Unsupported action");
                    if (implementation == "switchyard.role/v1" && (!Regex.IsMatch(body.GetProperty("roleId").GetString() ?? "", "^[A-Za-z0-9_.:-]{1,64}$") || !Intents.Contains(body.GetProperty("intent").GetString() ?? ""))) throw new InvalidOperationException("Invalid exact role intent");
                    var layout = GetKeyboardLayout(GetWindowThreadProcessId(GetForegroundWindow(), out _));
                    if (((long)layout & 0xffff) != 0x0409) throw new InvalidOperationException("Verify US host layout before binding firmware-mapped keys");
                    if (!RegisterHotKey(IntPtr.Zero, keyId, modifiers | 0x4000U, virtualKey)) throw new InvalidOperationException($"Hotkey unavailable (Windows error {Marshal.GetLastWin32Error()}); existing shortcuts were preserved");
                    Bindings.Add(keyId, new Binding(keyId, modifiers, virtualKey, body.GetRawText()));
                    Write(new { id, result = new { registered = true, bindingId = keyId, keyboardLayout = "US 0409" } });
                    break;
                case "unregister":
                    if (ReadOnly) throw new InvalidOperationException("This helper session permits category observation only");
                    var removeId = request.GetProperty("bindingId").GetInt32();
                    if (!Bindings.ContainsKey(removeId) || !UnregisterHotKey(IntPtr.Zero, removeId)) throw new InvalidOperationException("Exact hotkey unregistration failed");
                    Bindings.Remove(removeId); Write(new { id, result = new { removed = true } }); break;
                case "status":
                    Write(new { id, result = new { bindings = Bindings.Values.Select(b => new { bindingId = b.Id, modifiers = b.Modifiers, virtualKey = b.VirtualKey, body = JsonSerializer.Deserialize<JsonElement>(b.Body) }).ToArray() } }); break;
                case "foreground-category":
                    var window = GetForegroundWindow();
                    _ = GetWindowThreadProcessId(window, out var processId);
                    if (window == IntPtr.Zero || processId == 0) { Write(new { id, result = new { available = false, category = (string?)null, provenance = "Windows foreground process filename; no task identity", reason = "No foreground window is available in this Windows session" } }); break; }
                    try
                    {
                        using var foregroundProcess = Process.GetProcessById(checked((int)processId));
                        // The name is used in memory for this closed classification,
                        // then discarded. Never query titles, paths or arguments.
                        var category = foregroundProcess.ProcessName.ToLowerInvariant() switch
                        {
                            "windowsterminal" or "openconsole" or "conhost" or "wezterm-gui" or "alacritty" or "mintty" or "cmd" or "powershell" or "pwsh" or "wsl" or "bash" => "terminal",
                            "code" or "code-insiders" or "codium" or "vscodium" => "vscode",
                            "chatgpt" => "chatgpt", "claude" => "claude", "codex" => "codex",
                            "msedge" or "chrome" or "brave" or "firefox" or "opera" => "browser",
                            _ => "other"
                        };
                        Write(new { id, result = new { available = true, category, provenance = "Windows foreground process filename; no task identity" } });
                    }
                    catch { Write(new { id, result = new { available = false, category = (string?)null, provenance = "Windows foreground process filename; no task identity", reason = "The foreground process changed or could not be read" } }); }
                    break;
                case "stop":
                    Write(new { id, result = new { stopping = true } }); PostThreadMessageW(GetCurrentThreadId(), WmQuit, UIntPtr.Zero, IntPtr.Zero); break;
                default: throw new InvalidOperationException("Unsupported helper operation");
            }
        }
        catch (Exception error) { Write(new { id, error = error.Message }); }
    }
    private static async Task Fire(Binding binding)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(Origin!, "/api/suite/intent"));
            request.Headers.TryAddWithoutValidation("Authorization", "Bearer " + Token);
            request.Headers.TryAddWithoutValidation("Origin", Origin!.GetLeftPart(UriPartial.Authority));
            request.Content = new StringContent(binding.Body, Encoding.UTF8, "application/json");
            // The local server requires this exact content type.
            request.Content.Headers.ContentType = new("application/json");
            using var response = await Client.SendAsync(request);
            Write(new { @event = "intent-result", bindingId = binding.Id, acknowledged = response.IsSuccessStatusCode, taskCompletionVerified = false });
        }
        catch { Write(new { @event = "intent-result", bindingId = binding.Id, acknowledged = false, taskCompletionVerified = false }); }
    }
    public static int Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--runtime-command" })) return RuntimeCommandRunner.Run();
        if (args.Length != 0) return 2;
        if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("Windows hotkeys require an interactive Windows user session."); return 2; }
        var first = Console.ReadLine(); if (first is null || first.Length > 8192) return 2;
        using var initialization = JsonDocument.Parse(first);
        var init = initialization.RootElement;
        if (init.GetProperty("method").GetString() != "initialize" || !Uri.TryCreate(init.GetProperty("origin").GetString(), UriKind.Absolute, out Origin) || Origin.Scheme != "http" || !(Origin.Host == "127.0.0.1" || Origin.Host == "localhost") || Origin.AbsolutePath != "/" || Origin.UserInfo != "") return 2;
        Token = init.GetProperty("token").GetString() ?? ""; if (!Regex.IsMatch(Token, "^[A-Za-z0-9_-]{43}$")) return 2;
        ReadOnly = init.TryGetProperty("readOnly", out var readOnly) && readOnly.GetBoolean();
        var parent = Process.GetProcessById(init.GetProperty("parentPid").GetInt32()); var parentStart = parent.StartTime;
        var thread = GetCurrentThreadId(); PeekMessageW(out _, IntPtr.Zero, 0, 0, 0);
        using var watcher = new Timer(_ => { try { if (parent.HasExited || parent.StartTime != parentStart) PostThreadMessageW(thread, WmQuit, UIntPtr.Zero, IntPtr.Zero); } catch { PostThreadMessageW(thread, WmQuit, UIntPtr.Zero, IntPtr.Zero); } }, null, 1000, 1000);
        Write(new { id = init.GetProperty("id").GetInt32(), result = new { initialized = true, platform = "windows", protocolVersion = 2, readOnly = ReadOnly, effects = ReadOnly ? "closed foreground category observation only; no hotkey or input effects" : "closed authenticated local intents only" } });
        _ = Task.Run(() => { try { string? line; while ((line = Console.ReadLine()) != null) { if (line.Length > 16384) break; using var json = JsonDocument.Parse(line); Requests.Enqueue(json.RootElement.Clone()); PostThreadMessageW(thread, WmControl, UIntPtr.Zero, IntPtr.Zero); } } finally { PostThreadMessageW(thread, WmQuit, UIntPtr.Zero, IntPtr.Zero); } });
        try { while (GetMessageW(out var message, IntPtr.Zero, 0, 0) > 0) { if (message.Id == WmControl) while (Requests.TryDequeue(out var request)) Handle(request); else if (message.Id == WmHotkey && Bindings.TryGetValue((int)message.WParam.ToUInt64(), out var binding)) _ = Fire(binding); } }
        finally { foreach (var id in Bindings.Keys) UnregisterHotKey(IntPtr.Zero, id); Bindings.Clear(); Token = ""; }
        return 0;
    }
}
