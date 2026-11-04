// Closed native elevation boundary. No CLR, shell, caller-supplied paths, script,
// arbitrary program or inherited managed-runtime startup environment enters it.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <sddl.h>
#include <shellapi.h>
#include <shlobj.h>
#include <bcrypt.h>
#include <algorithm>
#include <array>
#include <stdexcept>
#include <string>
#include <vector>
#ifndef _WIN64
#error Switchyard setup requires the native 64-bit Windows target.
#endif

namespace {
[[noreturn]] void fail() { throw std::runtime_error("scoped-setup-unconfirmed"); }
void require(bool value) { if (!value) fail(); }
std::string ascii(const std::wstring& value) {std::string result;for(wchar_t c:value){require(c<=127);result.push_back(static_cast<char>(c));}return result;}
struct Handle {
    HANDLE value = INVALID_HANDLE_VALUE;
    Handle() = default;
    explicit Handle(HANDLE h) : value(h) {}
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    Handle(Handle&& h) noexcept : value(h.value) { h.value = INVALID_HANDLE_VALUE; }
    Handle& operator=(Handle&& h) noexcept { if (this != &h) { reset(); value=h.value; h.value=INVALID_HANDLE_VALUE; } return *this; }
    ~Handle() { reset(); }
    void reset() { if (value != INVALID_HANDLE_VALUE && value != nullptr) CloseHandle(value); value=INVALID_HANDLE_VALUE; }
    bool valid() const { return value != INVALID_HANDLE_VALUE && value != nullptr; }
};
struct LocalMemory { void* value=nullptr; ~LocalMemory() { if(value)LocalFree(value); } };
std::wstring parent(const std::wstring& path) { auto at=path.find_last_of(L'\\'); require(at!=std::wstring::npos&&at>=2); return path.substr(0,at==2?3:at); }
bool absolute(const std::wstring& path) { return path.size()>3&&path.size()<=2048&&((path[0]>=L'A'&&path[0]<=L'Z')||(path[0]>=L'a'&&path[0]<=L'z'))&&path[1]==L':'&&path[2]==L'\\'&&path.find_first_of(L"\r\n\"",3)==std::wstring::npos&&path.find(L':',2)==std::wstring::npos; }
std::wstring modulePath() {
    std::array<wchar_t,32768> text{}; DWORD length=GetModuleFileNameW(nullptr,text.data(),static_cast<DWORD>(text.size()));
    require(length>0&&length<text.size()); std::wstring path(text.data(),length); require(absolute(path)); return path;
}
Handle pin(const std::wstring& path,bool directory) {
    Handle h(CreateFileW(path.c_str(),FILE_READ_ATTRIBUTES|(directory?0:GENERIC_READ),directory?FILE_SHARE_READ|FILE_SHARE_WRITE:FILE_SHARE_READ,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT|(directory?FILE_FLAG_BACKUP_SEMANTICS:0),nullptr));
    BY_HANDLE_FILE_INFORMATION info{}; require(h.valid()&&GetFileInformationByHandle(h.value,&info)&&!(info.dwFileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)&&!!(info.dwFileAttributes&FILE_ATTRIBUTE_DIRECTORY)==directory);
    std::array<wchar_t,32768> resolved{};DWORD length=GetFinalPathNameByHandleW(h.value,resolved.data(),static_cast<DWORD>(resolved.size()),FILE_NAME_NORMALIZED|VOLUME_NAME_DOS);
    require(length>4&&length<resolved.size());std::wstring canonical(resolved.data(),length);require(canonical.rfind(L"\\\\?\\",0)==0&&_wcsicmp(canonical.substr(4).c_str(),path.c_str())==0);return h;
}
std::vector<Handle> pinParents(const std::wstring& file) {
    std::vector<Handle> handles;std::wstring path=parent(file);
    for(unsigned count=0;;count++){require(count<64);handles.push_back(pin(path,true));if(path.size()==3)break;path=parent(path);}return handles;
}
std::string hash(HANDLE file) {
    LARGE_INTEGER size{};require(GetFileSizeEx(file,&size)&&size.QuadPart>0&&size.QuadPart<=134217728);LARGE_INTEGER zero{};require(SetFilePointerEx(file,zero,nullptr,FILE_BEGIN));
    BCRYPT_ALG_HANDLE algorithm=nullptr;BCRYPT_HASH_HANDLE state=nullptr;std::vector<UCHAR> object;std::array<UCHAR,32> digest{};
    try {
        require(BCryptOpenAlgorithmProvider(&algorithm,BCRYPT_SHA256_ALGORITHM,nullptr,0)>=0);DWORD length=0,used=0;
        require(BCryptGetProperty(algorithm,BCRYPT_OBJECT_LENGTH,reinterpret_cast<PUCHAR>(&length),sizeof(length),&used,0)>=0&&used==sizeof(length)&&length>0&&length<65536);
        object.resize(length);require(BCryptCreateHash(algorithm,&state,object.data(),length,nullptr,0,0)>=0);
        std::array<UCHAR,65536> buffer{};LONGLONG total=0;DWORD read=0;
        while(true){require(ReadFile(file,buffer.data(),static_cast<DWORD>(buffer.size()),&read,nullptr));if(!read)break;total+=read;require(total<=size.QuadPart&&BCryptHashData(state,buffer.data(),read,0)>=0);}
        require(total==size.QuadPart&&BCryptFinishHash(state,digest.data(),static_cast<ULONG>(digest.size()),0)>=0);
        BCryptDestroyHash(state);state=nullptr;BCryptCloseAlgorithmProvider(algorithm,0);algorithm=nullptr;
    } catch(...) { if(state)BCryptDestroyHash(state);if(algorithm)BCryptCloseAlgorithmProvider(algorithm,0);throw; }
    static constexpr char hex[]="0123456789abcdef";std::string result;for(UCHAR byte:digest){result.push_back(hex[byte>>4]);result.push_back(hex[byte&15]);}return result;
}
std::wstring tokenSid() {
    Handle token;require(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.value));DWORD length=0;GetTokenInformation(token.value,TokenUser,nullptr,0,&length);require(length>0&&length<4096);std::vector<UCHAR> data(length);
    require(GetTokenInformation(token.value,TokenUser,data.data(),length,&length));LocalMemory text;require(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER*>(data.data())->User.Sid,reinterpret_cast<LPWSTR*>(&text.value)));return static_cast<wchar_t*>(text.value);
}
bool elevated() {Handle token;require(OpenProcessToken(GetCurrentProcess(),TOKEN_QUERY,&token.value));TOKEN_ELEVATION info{};DWORD length=0;require(GetTokenInformation(token.value,TokenElevation,&info,sizeof(info),&length)&&length==sizeof(info));return info.TokenIsElevated!=0;}
void validate(const std::wstring& sid,const std::wstring& id,const std::wstring& digest) {
    LocalMemory memory;require(sid.rfind(L"S-1-5-21-",0)==0&&sid.size()<128&&ConvertStringSidToSidW(sid.c_str(),reinterpret_cast<PSID*>(&memory.value))&&IsValidSid(memory.value)&&*GetSidSubAuthorityCount(memory.value)==5&&*GetSidSubAuthority(memory.value,0)==21);
    LocalMemory text;require(ConvertSidToStringSidW(memory.value,reinterpret_cast<LPWSTR*>(&text.value))&&sid==static_cast<wchar_t*>(text.value));
    require(id.size()==36&&digest.size()==64);for(size_t i=0;i<id.size();i++)require(i==8||i==13||i==18||i==23?id[i]==L'-':id[i]>=L'0'&&id[i]<=L'9'||id[i]>=L'a'&&id[i]<=L'f');
    for(wchar_t c:digest)require(c>=L'0'&&c<=L'9'||c>=L'a'&&c<=L'f');
}
std::wstring quote(const std::wstring& value) {require(value.find(L'"')==std::wstring::npos&&!value.empty()&&value.back()!=L'\\');return L"\""+value+L"\"";}
SECURITY_ATTRIBUTES security(LocalMemory& memory,bool directory) {
    const wchar_t* sddl=directory?L"O:BAG:SYD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)":L"O:BAG:SYD:P(A;;FA;;;SY)(A;;FA;;;BA)";
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl,SDDL_REVISION_1,&memory.value,nullptr));return SECURITY_ATTRIBUTES{sizeof(SECURITY_ATTRIBUTES),memory.value,FALSE};
}
void privateDirectory(const std::wstring& path) {LocalMemory descriptor;auto attributes=security(descriptor,true);require(CreateDirectoryW(path.c_str(),&attributes));}
std::wstring windowsDirectory() {std::array<wchar_t,32768> text{};UINT length=GetSystemWindowsDirectoryW(text.data(),static_cast<UINT>(text.size()));require(length>0&&length<text.size());return std::wstring(text.data(),length);}
std::wstring programFiles() {PWSTR text=nullptr;require(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramFiles,KF_FLAG_DONT_VERIFY,nullptr,&text)));std::wstring path(text);CoTaskMemFree(text);require(absolute(path));return path;}
void copyProtected(HANDLE source,const std::wstring& destination,const std::string& expected) {
    LocalMemory descriptor;auto attributes=security(descriptor,false);Handle output(CreateFileW(destination.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ,&attributes,CREATE_NEW,FILE_FLAG_OPEN_REPARSE_POINT,nullptr));require(output.valid());
    LARGE_INTEGER zero{};require(SetFilePointerEx(source,zero,nullptr,FILE_BEGIN));std::array<UCHAR,65536> bytes{};DWORD read=0;
    while(true){require(ReadFile(source,bytes.data(),static_cast<DWORD>(bytes.size()),&read,nullptr));if(!read)break;DWORD offset=0;while(offset<read){DWORD written=0;require(WriteFile(output.value,bytes.data()+offset,read-offset,&written,nullptr)&&written>0);offset+=written;}}
    require(FlushFileBuffers(output.value)&&hash(output.value)==expected);
}
DWORD managed(const std::wstring& image,const std::wstring& action,const std::wstring& sid,const std::wstring& id,const std::wstring& digest,const std::wstring& brokerDigest,const std::wstring& cache) {
    std::wstring windows=windowsDirectory();std::vector<std::wstring> variables={L"DOTNET_BUNDLE_EXTRACT_BASE_DIR="+cache,L"DOTNET_EnableDiagnostics=0",L"PATH="+windows+L"\\System32",L"SystemRoot="+windows,L"TEMP="+cache,L"TMP="+cache,L"WINDIR="+windows};
    std::sort(variables.begin(),variables.end(),[](const auto& a,const auto& b){return _wcsicmp(a.c_str(),b.c_str())<0;});std::vector<wchar_t> environment;for(const auto& variable:variables){environment.insert(environment.end(),variable.begin(),variable.end());environment.push_back(0);}environment.push_back(0);
    Handle job(CreateJobObjectW(nullptr,nullptr));JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;require(job.valid()&&SetInformationJobObject(job.value,JobObjectExtendedLimitInformation,&limits,sizeof(limits)));
    SIZE_T size=0;InitializeProcThreadAttributeList(nullptr,1,0,&size);require(size>0&&size<65536);std::vector<UCHAR> storage(size);auto attributes=reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());require(InitializeProcThreadAttributeList(attributes,1,0,&size));
    PROCESS_INFORMATION process{};STARTUPINFOEXW startup{};startup.StartupInfo.cb=sizeof(startup);startup.lpAttributeList=attributes;
    std::wstring command=quote(image)+L" --windows-storage-broker-bootstrap "+action.substr(2)+L" "+sid+L" "+id+L" "+digest+L" "+brokerDigest;
    bool updated=UpdateProcThreadAttribute(attributes,0,PROC_THREAD_ATTRIBUTE_JOB_LIST,&job.value,sizeof(HANDLE),nullptr,nullptr)!=FALSE;
    bool created=updated&&CreateProcessW(image.c_str(),command.data(),nullptr,nullptr,FALSE,CREATE_SUSPENDED|CREATE_NO_WINDOW|CREATE_UNICODE_ENVIRONMENT|EXTENDED_STARTUPINFO_PRESENT,environment.data(),parent(image).c_str(),&startup.StartupInfo,&process);
    DeleteProcThreadAttributeList(attributes);require(created);Handle owner(process.hProcess),thread(process.hThread);require(ResumeThread(thread.value)!=static_cast<DWORD>(-1));
    require(WaitForSingleObject(owner.value,120000)==WAIT_OBJECT_0);DWORD code=3;require(GetExitCodeProcess(owner.value,&code));return code;
}
DWORD install(HANDLE source,const std::wstring& action,const std::wstring& sid,const std::wstring& id,const std::wstring& digest,const std::wstring& brokerDigest) {
    // The stage name contains only already-validated identity metadata. No
    // caller-selected destination or program path is accepted.
    std::wstring root=programFiles()+L"\\Switchyard.Setup-"+sid+L"-"+id,helper=root+L"\\Switchyard.Hotkeys.exe",cache=root+L"\\runtime";
    auto parents=pinParents(root);privateDirectory(root);Handle rootPin=pin(root,true);privateDirectory(cache);Handle cachePin=pin(cache,true);
    std::string expected=ascii(digest);copyProtected(source,helper,expected);Handle helperPin=pin(helper,false);require(hash(helperPin.value)==expected);
    DWORD code=managed(helper,action,sid,id,digest,brokerDigest,cache);require(code==0);require(hash(helperPin.value)==expected);helperPin.reset();
    // Never recurse over runtime or installation state. Unknown files and every
    // failed/uncertain effect remain for exact privileged reconciliation.
    require(DeleteFileW(helper.c_str()));cachePin.reset();require(RemoveDirectoryW(cache.c_str()));rootPin.reset();require(RemoveDirectoryW(root.c_str()));return 0;
}
void result(const char* status,bool started) {std::string json=std::string("{\"schema\":\"switchyard-windows-native-setup/v1\",\"status\":\"")+status+"\",\"effectStarted\":"+(started?"true":"false")+"}\n";DWORD written=0;WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),json.data(),static_cast<DWORD>(json.size()),&written,nullptr);}
}
int wmain(int count,wchar_t** arguments) {
    bool started=false;
    try {
        require(SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_SYSTEM32));std::wstring image=modulePath();require(image.substr(image.find_last_of(L'\\')+1)==L"Switchyard.Setup.exe");
        auto directories=pinParents(image);Handle self=pin(image,false);
        if(count==2&&std::wstring(arguments[1])==L"--metadata"){std::wstring sid=tokenSid();std::string json="{\"schema\":\"switchyard-windows-native-setup/v1\",\"status\":\"available\",\"clientSid\":\""+ascii(sid)+"\",\"effectStarted\":false}\n";DWORD written=0;WriteFile(GetStdHandle(STD_OUTPUT_HANDLE),json.data(),static_cast<DWORD>(json.size()),&written,nullptr);return 0;}
        require(count==5||count==6);std::wstring action=arguments[1],sid=arguments[2],id=arguments[3],digest=arguments[4];require(action==L"--install-bootstrap"&&count==5||action==L"--remove-bootstrap"&&count==6);std::wstring brokerDigest=count==6?arguments[5]:digest;validate(sid,id,digest);validate(sid,id,brokerDigest);
        std::wstring helper=parent(image)+L"\\Switchyard.Hotkeys.exe";Handle source=pin(helper,false);require(hash(source.value)==ascii(digest));
        if(!elevated()) {
            require(tokenSid()==sid);std::wstring parameters=action+L" "+sid+L" "+id+L" "+digest+(count==6?L" "+brokerDigest:L"");SHELLEXECUTEINFOW execute{};execute.cbSize=sizeof(execute);execute.fMask=SEE_MASK_NOCLOSEPROCESS|SEE_MASK_NOASYNC|SEE_MASK_FLAG_NO_UI;execute.lpVerb=L"runas";execute.lpFile=image.c_str();execute.lpParameters=parameters.c_str();execute.nShow=SW_HIDE;
            if(!ShellExecuteExW(&execute)){if(GetLastError()==ERROR_CANCELLED){result("cancelled",false);return 1223;}fail();}
            started=true;Handle child(execute.hProcess);require(child.valid()&&WaitForSingleObject(child.value,INFINITE)==WAIT_OBJECT_0);DWORD code=3;require(GetExitCodeProcess(child.value,&code));if(code!=0)fail();
        } else {started=true;install(source.value,action,sid,id,digest,brokerDigest);}
        result("completed",true);return 0;
    } catch(...) {result(started?"outcome-unconfirmed":"unavailable",started);return started?3:2;}
}
