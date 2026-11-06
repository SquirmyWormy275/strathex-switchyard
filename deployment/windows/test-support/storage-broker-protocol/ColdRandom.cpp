// CI-only cold-process observation. Never shipped or used as an RNG fallback.
#include <windows.h>
#include <bcrypt.h>
#include <wincrypt.h>
#include <cstdint>
#include <cwchar>

static std::uint32_t clear_and_verify(void* data, size_t size) {
    SecureZeroMemory(data, size);
    auto bytes = static_cast<volatile unsigned char*>(data);
    for (size_t i = 0; i < size; ++i) if (bytes[i] != 0) return 0;
    return 1;
}

static void legacy_observation(LPCWSTR provider, std::uint32_t* report) {
    unsigned char bytes[32] = {};
    HCRYPTPROV legacy = 0;
    SetLastError(ERROR_SUCCESS);
    BOOL acquired = CryptAcquireContextW(&legacy, nullptr, provider, PROV_RSA_FULL, CRYPT_VERIFYCONTEXT | CRYPT_SILENT);
    report[0] = acquired ? 1u : 0u;
    report[1] = acquired ? 0u : GetLastError();
    if (acquired && legacy != 0) {
        SetLastError(ERROR_SUCCESS);
        BOOL generated = CryptGenRandom(legacy, static_cast<DWORD>(sizeof(bytes)), bytes);
        report[2] = generated ? 1u : 0u;
        report[3] = generated ? 0u : GetLastError();
        SetLastError(ERROR_SUCCESS);
        BOOL released = CryptReleaseContext(legacy, 0);
        report[4] = released ? 1u : 0u;
        report[5] = released ? 0u : GetLastError();
        report[6] = released ? 1u : 0u;
    } else {
        report[6] = !acquired && legacy == 0 ? 1u : 0u;
        if (legacy != 0) (void)CryptReleaseContext(legacy, 0);
    }
    report[7] = clear_and_verify(bytes, sizeof(bytes));
}

static void default_observation(DWORD flags, std::uint32_t* report) {
    wchar_t name[256] = {};
    DWORD size = static_cast<DWORD>(sizeof(name));
    SetLastError(ERROR_SUCCESS);
    BOOL found = CryptGetDefaultProviderW(PROV_RSA_FULL, nullptr, flags, name, &size);
    report[0] = found ? 1u : 0u;
    report[1] = found ? 0u : GetLastError();
    if (found) {
        if (size < sizeof(wchar_t) || size > sizeof(name) || size % sizeof(wchar_t) != 0 || name[size / sizeof(wchar_t) - 1] != L'\0') report[2] = 4;
        else if (std::wcscmp(name, MS_ENHANCED_PROV_W) == 0) report[2] = 1;
        else if (std::wcscmp(name, MS_STRONG_PROV_W) == 0) report[2] = 2;
        else if (std::wcscmp(name, MS_DEF_PROV_W) == 0) report[2] = 3;
    }
    report[3] = clear_and_verify(name, sizeof(name));
}

int wmain(int argc, wchar_t** argv) {
    if (argc != 2) return 64;
    unsigned char bytes[32] = {};
    BCRYPT_ALG_HANDLE provider = nullptr;
    // V3: default legacy acquisition is first in a fresh native process.
    // Read-only default-name lookup and one fixed explicit-provider observation
    // distinguish lookup from provider access. Nothing changes provider defaults.
    // Only fixed status/boolean/classification words leave; no names or entropy.
    std::uint32_t report[32] = {0x53584352, 3};
    legacy_observation(nullptr, report + 8);
    default_observation(CRYPT_USER_DEFAULT, report + 24);
    default_observation(CRYPT_MACHINE_DEFAULT, report + 28);
    legacy_observation(MS_ENHANCED_PROV_W, report + 16);
    report[2] = static_cast<std::uint32_t>(BCryptGenRandom(nullptr, bytes, static_cast<ULONG>(sizeof(bytes)), BCRYPT_USE_SYSTEM_PREFERRED_RNG));
    SecureZeroMemory(bytes, sizeof(bytes));
    report[3] = static_cast<std::uint32_t>(BCryptOpenAlgorithmProvider(&provider, BCRYPT_RNG_ALGORITHM, MS_PRIMITIVE_PROVIDER, 0));
    if (report[3] == 0 && provider != nullptr) {
        report[4] = static_cast<std::uint32_t>(BCryptGenRandom(provider, bytes, static_cast<ULONG>(sizeof(bytes)), 0));
        report[5] = static_cast<std::uint32_t>(BCryptCloseAlgorithmProvider(provider, 0));
        report[6] = report[5] == 0 ? 1u : 0u;
    } else {
        report[6] = report[3] != 0 && provider == nullptr ? 1u : 0u;
        if (provider != nullptr) (void)BCryptCloseAlgorithmProvider(provider, 0);
    }
    report[7] = clear_and_verify(bytes, sizeof(bytes));
    HANDLE output = CreateFileW(argv[1], GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (output == INVALID_HANDLE_VALUE) return 65;
    DWORD written = 0;
    BOOL wrote = WriteFile(output, report, static_cast<DWORD>(sizeof(report)), &written, nullptr);
    BOOL closed = CloseHandle(output);
    return wrote && written == sizeof(report) && closed ? 0 : 66;
}
