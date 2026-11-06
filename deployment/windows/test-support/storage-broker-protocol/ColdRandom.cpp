// CI-only cold-process observation. Never shipped or used as an RNG fallback.
#include <windows.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <cstdint>

static std::uint32_t clear_and_verify(unsigned char (&bytes)[32]) {
    SecureZeroMemory(bytes, sizeof(bytes));
    for (volatile unsigned char* p = bytes; p < bytes + sizeof(bytes); ++p) {
        if (*p != 0) return 0;
    }
    return 1;
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 64;
    unsigned char bytes[32] = {};
    BCRYPT_ALG_HANDLE provider = nullptr;
    // V2 observes legacy CryptoAPI FIRST in a fresh native process. The original
    // BCrypt observations follow; neither path supplies entropy to Node.
    // Fixed status/boolean words only. No entropy, paths or handles leave.
    std::uint32_t report[16] = {0x53584352, 2};
    HCRYPTPROV legacy = 0;
    SetLastError(ERROR_SUCCESS);
    BOOL acquired = CryptAcquireContextW(&legacy, nullptr, nullptr, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT | CRYPT_SILENT);
    report[8] = acquired ? 1u : 0u;
    report[9] = acquired ? 0u : GetLastError();
    if (acquired && legacy != 0) {
        SetLastError(ERROR_SUCCESS);
        BOOL generated = CryptGenRandom(legacy, static_cast<DWORD>(sizeof(bytes)), bytes);
        report[10] = generated ? 1u : 0u;
        report[11] = generated ? 0u : GetLastError();
        SetLastError(ERROR_SUCCESS);
        BOOL released = CryptReleaseContext(legacy, 0);
        report[12] = released ? 1u : 0u;
        report[13] = released ? 0u : GetLastError();
        report[14] = released ? 1u : 0u;
    } else {
        report[14] = !acquired && legacy == 0 ? 1u : 0u;
        if (legacy != 0) (void)CryptReleaseContext(legacy, 0);
    }
    report[15] = clear_and_verify(bytes);
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
    report[7] = clear_and_verify(bytes);
    HANDLE output = CreateFileW(argv[1], GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (output == INVALID_HANDLE_VALUE) return 65;
    DWORD written = 0;
    BOOL wrote = WriteFile(output, report, static_cast<DWORD>(sizeof(report)), &written, nullptr);
    BOOL closed = CloseHandle(output);
    return wrote && written == sizeof(report) && closed ? 0 : 66;
}
