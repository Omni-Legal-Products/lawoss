// A tiny native supervisor avoids compiling C# on every PowerShell command.
// The command starts suspended and joins a kill-on-close job before any user
// code executes. Descendants cannot request breakaway from this job.
#define UNICODE
#define _UNICODE
#include <windows.h>
#include <stdio.h>
#include <wchar.h>

int wmain(int argc, wchar_t **argv) {
    if (argc != 2) return 125;
    HANDLE job = CreateJobObjectW(NULL, NULL);
    if (!job) return 125;
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) {
        CloseHandle(job); return 125;
    }
    wchar_t system[MAX_PATH], shell[MAX_PATH], command[32768];
    if (!GetSystemDirectoryW(system, MAX_PATH)) { CloseHandle(job); return 125; }
    if (swprintf(shell, MAX_PATH, L"%ls\\WindowsPowerShell\\v1.0\\powershell.exe", system) < 0 ||
        swprintf(command, 32768, L"\"%ls\" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"%ls\"", shell, argv[1]) < 0) {
        CloseHandle(job); return 125;
    }
    STARTUPINFOW startup = {0}; startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
    startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
    PROCESS_INFORMATION child = {0};
    if (!CreateProcessW(shell, command, NULL, NULL, TRUE, CREATE_SUSPENDED | CREATE_NO_WINDOW, NULL, NULL, &startup, &child)) {
        fwprintf(stderr, L"Could not start PowerShell (%lu).\n", GetLastError()); CloseHandle(job); return 125;
    }
    if (!AssignProcessToJobObject(job, child.hProcess) || ResumeThread(child.hThread) == (DWORD)-1) {
        TerminateProcess(child.hProcess, 125); WaitForSingleObject(child.hProcess, INFINITE);
        CloseHandle(child.hThread); CloseHandle(child.hProcess); CloseHandle(job); return 125;
    }
    CloseHandle(child.hThread);
    WaitForSingleObject(child.hProcess, INFINITE);
    DWORD code = 1; GetExitCodeProcess(child.hProcess, &code);
    TerminateJobObject(job, code);
    // A normal completion is acknowledged only after descendants have exited.
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION usage;
    do {
        if (!QueryInformationJobObject(job, JobObjectBasicAccountingInformation, &usage, sizeof(usage), NULL)) {
            code = 125; break;
        }
        if (usage.ActiveProcesses) Sleep(1);
    } while (usage.ActiveProcesses);
    CloseHandle(child.hProcess); CloseHandle(job);
    return (int)code;
}
