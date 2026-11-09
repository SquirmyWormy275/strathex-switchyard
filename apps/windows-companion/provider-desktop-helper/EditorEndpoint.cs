using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Sxsy.B122.ProviderDesktopHelper;

internal static partial class Program
{
    private const uint EndpointReadControl = 0x20000, EndpointOpenReparsePoint = 0x200000;

    // Metadata only. This role never changes permissions, creates a file, or
    // reads a token with more than QUERY. The current user must own both the
    // endpoint and its containing directory. Only that user, SYSTEM and the
    // local administrators may have effective allow entries.
    private static byte[] EditorEndpointSecurity(SafeFileHandle handle, SecurityIdentifier user)
    {
        if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
        if (EndpointGetSecurityInfo(handle, 1, 5, out _, out _, out _, out _, out IntPtr descriptor) != 0)
            throw new ProtocolException("endpoint_security_unavailable");
        try
        {
            uint size = EndpointGetSecurityDescriptorLength(descriptor);
            if (size is < 20 or > 65536) throw new ProtocolException("endpoint_security_bound");
            byte[] bytes = new byte[size]; Marshal.Copy(descriptor, bytes, 0, checked((int)size));
            var security = new RawSecurityDescriptor(bytes, 0);
            if (security.Owner is null || !user.Equals(security.Owner) || security.DiscretionaryAcl is null || !security.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclPresent))
                throw new ProtocolException("endpoint_owner_or_acl_changed");
            foreach (GenericAce entry in security.DiscretionaryAcl)
            {
                if (entry is not CommonAce ace || ace.IsCallback || ace.AceQualifier is not (AceQualifier.AccessAllowed or AceQualifier.AccessDenied))
                    throw new ProtocolException("endpoint_acl_unsupported");
                if (ace.AceQualifier == AceQualifier.AccessDenied || ace.AceFlags.HasFlag(AceFlags.InheritOnly) || ace.AccessMask == 0) continue;
                if (!user.Equals(ace.SecurityIdentifier) && ace.SecurityIdentifier.Value is not ("S-1-5-18" or "S-1-5-32-544"))
                    throw new ProtocolException("endpoint_not_private");
            }
            return bytes;
        }
        finally { EndpointLocalFree(descriptor); }
    }

    private static int ReadEditorEndpoint()
    {
        var directories = new List<(string Path, SafeFileHandle Handle, ByHandleFileInformation Identity)>();
        byte[]? bytes = null;
        try
        {
            if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
            using JsonDocument document = ParseJson(ReadBoundedLine(Console.In, 8192));
            JsonElement request = document.RootElement; RequireProperties(request, "schema", "requestId", "path");
            string id = Text(request, "requestId"), path = Text(request, "path");
            if (Text(request, "schema") != "switchyard-editor-endpoint-query/v1" || !Guid.TryParseExact(id, "D", out Guid guid) || guid == Guid.Empty)
                throw new ProtocolException("invalid_endpoint_query");
            if (Encoding.UTF8.GetByteCount(path) > 4096 || path.Length < 4 || !char.IsAsciiLetter(path[0]) || path[1] != ':' || path[2] != '\\'
                || path[3..].Any(c => c < 32 || c == 127 || "<>:\"/|?*".Contains(c)) || Path.GetFullPath(path) != path || Path.GetFileName(path) != "endpoint.json"
                || path[3..].Split('\\').Any(p => p.Length == 0 || p.EndsWith('.') || p.EndsWith(' ') || System.Text.RegularExpressions.Regex.IsMatch(p, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", System.Text.RegularExpressions.RegexOptions.IgnoreCase)))
                throw new ProtocolException("invalid_endpoint_path");
            using var process = new SafeFileHandle(GetCurrentProcess(), ownsHandle: false);
            var user = new SecurityIdentifier(ProcessOwner(process).User, 0);
            string parent = Path.GetDirectoryName(path)!;
            var names = new List<string>();
            for (string? name = parent; name is not null; name = Path.GetDirectoryName(name))
            { if (names.Count >= 64) throw new ProtocolException("endpoint_directory_bound"); names.Add(name); }
            names.Reverse();
            foreach (string name in names)
            {
                var handle = CreateFileW(name, FileReadAttributes | (name == parent ? EndpointReadControl : 0), FileShareRead | FileShareWrite,
                    IntPtr.Zero, OpenExisting, FileFlagBackupSemantics | EndpointOpenReparsePoint, IntPtr.Zero);
                try
                {
                    if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var info) || (info.FileAttributes & 0x410) != 0x10 || !SamePath(FinalPath(handle), name))
                        throw new ProtocolException("endpoint_directory_changed");
                    directories.Add((name, handle, info));
                }
                catch { handle.Dispose(); throw; }
            }
            byte[] parentSecurity = EditorEndpointSecurity(directories[^1].Handle, user);
            using SafeFileHandle file = CreateFileW(path, GenericRead | EndpointReadControl, FileShareRead, IntPtr.Zero, OpenExisting, EndpointOpenReparsePoint, IntPtr.Zero);
            if (file.IsInvalid || !GetFileInformationByHandle(file, out var identity) || (identity.FileAttributes & 0x410) != 0 || identity.NumberOfLinks != 1
                || identity.FileSize is < 1 or > 4096 || !SamePath(FinalPath(file), path)) throw new ProtocolException("endpoint_file_changed");
            byte[] fileSecurity = EditorEndpointSecurity(file, user);
            bytes = new byte[checked((int)identity.FileSize)];
            using (var borrowed = new SafeFileHandle(file.DangerousGetHandle(), ownsHandle: false))
            using (var stream = new FileStream(borrowed, FileAccess.Read, 4096, false))
            { stream.ReadExactly(bytes); if (stream.ReadByte() != -1) throw new ProtocolException("endpoint_size_changed"); }
            string text = new UTF8Encoding(false, true).GetString(bytes);
            using JsonDocument endpoint = ParseJson(text);
            if (endpoint.RootElement.ValueKind != JsonValueKind.Object) throw new ProtocolException("invalid_endpoint_metadata");
            bool SameIdentity(ByHandleFileInformation a, ByHandleFileInformation b) => a.VolumeSerialNumber == b.VolumeSerialNumber && a.FileIndexHigh == b.FileIndexHigh && a.FileIndexLow == b.FileIndexLow;
            foreach (var held in directories)
                if (!GetFileInformationByHandle(held.Handle, out var now) || !SameIdentity(held.Identity, now) || (now.FileAttributes & 0x410) != 0x10 || !SamePath(FinalPath(held.Handle), held.Path))
                    throw new ProtocolException("endpoint_directory_changed");
            using SafeFileHandle named = CreateFileW(path, FileReadAttributes, FileShareRead, IntPtr.Zero, OpenExisting, EndpointOpenReparsePoint, IntPtr.Zero);
            if (named.IsInvalid || !GetFileInformationByHandle(named, out var current) || !SameIdentity(identity, current) || current.NumberOfLinks != 1 || current.FileSize != identity.FileSize || (current.FileAttributes & 0x410) != 0
                || !SamePath(FinalPath(named), path) || !fileSecurity.SequenceEqual(EditorEndpointSecurity(file, user)) || !parentSecurity.SequenceEqual(EditorEndpointSecurity(directories[^1].Handle, user)))
                throw new ProtocolException("endpoint_changed_during_read");
            Write(new { schema = "switchyard-editor-endpoint-result/v1", requestId = id, path, text, sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                device = identity.VolumeSerialNumber.ToString(CultureInfo.InvariantCulture), inode = (((ulong)identity.FileIndexHigh << 32) | identity.FileIndexLow).ToString(CultureInfo.InvariantCulture),
                size = identity.FileSize.ToString(CultureInfo.InvariantCulture), currentUserVerified = true, privateAclVerified = true, tokenAccessMask = TokenQuery, fileModified = false });
            return 0;
        }
        catch (ProtocolException e) { Write(new { schema = "switchyard-editor-endpoint-error/v1", code = e.Code }); return 65; }
        catch { Write(new { schema = "switchyard-editor-endpoint-error/v1", code = "native_failure" }); return 70; }
        finally { if (bytes is not null) CryptographicOperations.ZeroMemory(bytes); foreach (var item in directories.AsEnumerable().Reverse()) item.Handle.Dispose(); }
    }
    [DllImport("advapi32.dll", EntryPoint = "GetSecurityInfo")] private static extern uint EndpointGetSecurityInfo(SafeFileHandle handle, uint type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll", EntryPoint = "GetSecurityDescriptorLength")] private static extern uint EndpointGetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll", EntryPoint = "LocalFree")] private static extern IntPtr EndpointLocalFree(IntPtr memory);

    // Explicit synthetic test setup, separate from the read-only endpoint role.
    // The caller retains its original temporary parent identity and cleanup.
    // Only fresh fixed-name fixtures below one new UUID directory are created;
    // no existing file/ACL, arbitrary content, identity or permission is changed.
    private static int CreateEditorEndpointFixture()
    {
        try
        {
            if (!OperatingSystem.IsWindows()) throw new ProtocolException("windows_required");
            using JsonDocument document = ParseJson(ReadBoundedLine(Console.In, 8192));
            JsonElement request = document.RootElement; RequireProperties(request, "schema", "requestId", "parent", "device", "inode");
            string id = Text(request, "requestId"), parent = Text(request, "parent");
            if (Text(request, "schema") != "switchyard-editor-endpoint-fixture-query/v1" || !Guid.TryParseExact(id, "D", out Guid guid) || guid == Guid.Empty
                || parent.Length is < 4 or > 2048 || !char.IsAsciiLetter(parent[0]) || parent[1] != ':' || parent[2] != '\\' || Path.GetFullPath(parent) != parent
                || !Path.GetFileName(parent).StartsWith("switchyard-endpoint-", StringComparison.Ordinal) || parent[3..].Any(c => c < 32 || c == 127 || "<>:\"/|?*".Contains(c)))
                throw new ProtocolException("invalid_endpoint_fixture");
            using SafeFileHandle heldParent = CreateFileW(parent, FileReadAttributes, FileShareRead | FileShareWrite, IntPtr.Zero, OpenExisting, FileFlagBackupSemantics | EndpointOpenReparsePoint, IntPtr.Zero);
            if (heldParent.IsInvalid || !GetFileInformationByHandle(heldParent, out var parentInfo) || (parentInfo.FileAttributes & 0x410) != 0x10 || !SamePath(FinalPath(heldParent), parent)
                || Text(request, "device") != parentInfo.VolumeSerialNumber.ToString(CultureInfo.InvariantCulture) || Text(request, "inode") != (((ulong)parentInfo.FileIndexHigh << 32) | parentInfo.FileIndexLow).ToString(CultureInfo.InvariantCulture))
                throw new ProtocolException("endpoint_fixture_parent_changed");
            using var process = new SafeFileHandle(GetCurrentProcess(), ownsHandle: false);
            string sid = new SecurityIdentifier(ProcessOwner(process).User, 0).Value;
            EndpointFixtureSecurity Security(bool directory, bool shared)
            {
                string flags = directory ? "OICI" : "", sddl = $"O:{sid}D:P(A;{flags};FA;;;{sid})" + (shared ? "(A;;FR;;;WD)" : "");
                if (!EndpointConvertSecurity(sddl, 1, out IntPtr descriptor, out _)) throw new ProtocolException("endpoint_fixture_security_failed");
                return new EndpointFixtureSecurity { Length = checked((uint)Marshal.SizeOf<EndpointFixtureSecurity>()), Descriptor = descriptor, Inherit = false };
            }
            void NewDirectory(string path, bool shared = false)
            {
                var security = Security(true, shared);
                try { if (!EndpointCreateDirectory(path, ref security)) throw new ProtocolException("endpoint_fixture_directory_exists_or_failed"); }
                finally { EndpointLocalFree(security.Descriptor); }
            }
            string root = Path.Combine(parent, "fixture-" + id); NewDirectory(root);
            foreach (string name in new[] { "private", "shared-file", "shared-parent", "hard-link", "oversize" })
            {
                string directory = Path.Combine(root, name); NewDirectory(directory, name == "shared-parent");
                var security = Security(false, name == "shared-file");
                try
                {
                    using SafeFileHandle file = EndpointCreateFile(Path.Combine(directory, "endpoint.json"), 0x40000000, FileShareRead, ref security, 1, EndpointOpenReparsePoint, IntPtr.Zero);
                    if (file.IsInvalid) throw new ProtocolException("endpoint_fixture_file_exists_or_failed");
                    using var stream = new FileStream(file, FileAccess.Write); byte[] bytes = Encoding.UTF8.GetBytes(name == "oversize" ? new string('x', 4097) : "{\"synthetic\":true}"); stream.Write(bytes); stream.Flush(true);
                }
                finally { EndpointLocalFree(security.Descriptor); }
            }
            Write(new { schema = "switchyard-editor-endpoint-fixture-result/v1", requestId = id, root, tokenAccessMask = TokenQuery, syntheticOnly = true, existingFilesModified = false }); return 0;
        }
        catch (ProtocolException e) { Write(new { schema = "switchyard-editor-endpoint-fixture-error/v1", code = e.Code }); return 65; }
        catch { Write(new { schema = "switchyard-editor-endpoint-fixture-error/v1", code = "native_failure" }); return 70; }
    }
    [StructLayout(LayoutKind.Sequential)] private struct EndpointFixtureSecurity { public uint Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
    [DllImport("advapi32.dll", EntryPoint = "ConvertStringSecurityDescriptorToSecurityDescriptorW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EndpointConvertSecurity(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool EndpointCreateDirectory(string path, ref EndpointFixtureSecurity security);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle EndpointCreateFile(string path, uint access, uint sharing, ref EndpointFixtureSecurity security, uint creation, uint flags, IntPtr template);
}
