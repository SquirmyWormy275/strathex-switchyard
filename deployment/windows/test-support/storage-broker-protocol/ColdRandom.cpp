// CI-only cold-process observation. Never shipped or used as an RNG fallback.
#include <windows.h>
#include <bcrypt.h>
#include <cstdint>

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 64;
    unsigned char bytes[32] = {};
    BCRYPT_ALG_HANDLE provider = nullptr;
    // Fixed little-endian words: magic, version, four NTSTATUS values,
    // provider-handle closure and cleared-buffer witnesses. No entropy leaves.
    std::uint32_t report[8] = {0x53584352, 1, 0, 0, 0, 0, 0, 0};
    report[2] = static_cast<std::uint32_t>(BCryptGenRandom(nullptr, bytes, static_cast<ULONG>(sizeof(bytes)), BCRYPT_USE_SYSTEM_PREFERRED_RNG));
    SecureZeroMemory(bytes, sizeof(bytes));
    report[3] = static_cast<std::uint32_t>(BCryptOpenAlgorithmProvider(&provider, BCRYPT_RNG_ALGORITHM, MS_PRIMITIVE_PROVIDER, 0));
    if (report[3] == 0 && provider != nullptr) {
        report[4] = static_cast<std::uint32_t>(BCryptGenRandom(provider, bytes, static_cast<ULONG>(sizeof(bytes)), 0));
        report[5] = static_cast<std::uint32_t>(BCryptCloseAlgorithmProvider(provider, 0));
        report[6] = report[5] == 0 ? 1u : 0u;
    } else {
        // An unexpected handle on failure must not be reported as closed.
        report[6] = report[3] != 0 && provider == nullptr ? 1u : 0u;
        if (provider != nullptr) (void)BCryptCloseAlgorithmProvider(provider, 0);
    }
    SecureZeroMemory(bytes, sizeof(bytes));
    report[7] = 1;
    for (volatile unsigned char* p = bytes; p < bytes + sizeof(bytes); ++p) {
        if (*p != 0) report[7] = 0;
    }
    HANDLE output = CreateFileW(argv[1], GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (output == INVALID_HANDLE_VALUE) return 65;
    DWORD written = 0;
    BOOL wrote = WriteFile(output, report, static_cast<DWORD>(sizeof(report)), &written, nullptr);
    BOOL closed = CloseHandle(output);
    return wrote && written == sizeof(report) && closed ? 0 : 66;
}
