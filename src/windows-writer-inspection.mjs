const WRITER_QUERY = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class CodexRestartManagerLock {
  const int ERROR_SUCCESS = 0;
  const int ERROR_MORE_DATA = 234;
  const int CCH_RM_SESSION_KEY = 32;
  const int CCH_RM_MAX_APP_NAME = 255;
  const int CCH_RM_MAX_SVC_NAME = 63;

  [StructLayout(LayoutKind.Sequential)]
  struct RM_UNIQUE_PROCESS {
    public int ProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  enum RM_APP_TYPE {
    Unknown = 0, MainWindow = 1, OtherWindow = 2, Service = 3,
    Explorer = 4, Console = 5, Critical = 1000
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
    public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
    public string ServiceShortName;
    public RM_APP_TYPE ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool Restartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmStartSession(out uint handle, int flags, string sessionKey);
  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  static extern int RmRegisterResources(uint handle, uint fileCount, string[] files,
    uint applicationCount, IntPtr applications, uint serviceCount, string[] services);
  [DllImport("rstrtmgr.dll")]
  static extern int RmGetList(uint handle, out uint needed, ref uint count,
    [In, Out] RM_PROCESS_INFO[] processes, ref uint rebootReasons);
  [DllImport("rstrtmgr.dll")]
  static extern int RmEndSession(uint handle);

  public static int[] Holders(string filePath) {
    uint handle;
    string key = Guid.NewGuid().ToString("N").Substring(0, CCH_RM_SESSION_KEY);
    int result = RmStartSession(out handle, 0, key);
    if (result != ERROR_SUCCESS) throw new InvalidOperationException("RmStartSession failed: " + result);
    try {
      result = RmRegisterResources(handle, 1, new [] { filePath }, 0, IntPtr.Zero, 0, null);
      if (result != ERROR_SUCCESS) throw new InvalidOperationException("RmRegisterResources failed: " + result);
      uint needed = 0, count = 0, reasons = 0;
      result = RmGetList(handle, out needed, ref count, null, ref reasons);
      if (result == ERROR_SUCCESS) return new int[0];
      if (result != ERROR_MORE_DATA) throw new InvalidOperationException("RmGetList sizing failed: " + result);
      var processes = new RM_PROCESS_INFO[needed];
      count = needed;
      result = RmGetList(handle, out needed, ref count, processes, ref reasons);
      if (result != ERROR_SUCCESS) throw new InvalidOperationException("RmGetList failed: " + result);
      var holders = new List<int>();
      for (int index = 0; index < count; index++) holders.Add(processes[index].Process.ProcessId);
      return holders.ToArray();
    } finally {
      RmEndSession(handle);
    }
  }
}
'@
$lockPath = $env:CODEX_CONTROL_LOCK_PATH
$holders = @(if (Test-Path -LiteralPath $lockPath) { [CodexRestartManagerLock]::Holders($lockPath) })
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine)
[pscustomobject]@{ HolderPids=$holders; Processes=$processes } | ConvertTo-Json -Depth 4 -Compress
`;

function normalizeProcess(row) {
  const pid = Number(row?.ProcessId);
  const parentPid = Number(row?.ParentProcessId);
  const command = String(row?.CommandLine || "").trim();
  const executablePath = String(row?.ExecutablePath || "").trim();
  if (!Number.isInteger(pid)) return null;
  return { pid, parentPid: Number.isInteger(parentPid) ? parentPid : 0, command, executablePath };
}

export async function inspectWindowsWriter(lockPath, { execFileImpl }) {
  try {
    const { stdout } = await execFileImpl(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", WRITER_QUERY],
      { windowsHide: true, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, CODEX_CONTROL_LOCK_PATH: lockPath } }
    );
    const parsed = JSON.parse(String(stdout || ""));
    const holderPids = (Array.isArray(parsed?.HolderPids) ? parsed.HolderPids : parsed?.HolderPids == null ? [] : [parsed.HolderPids])
      .map(Number)
      .filter(Number.isInteger);
    const processRows = Array.isArray(parsed?.Processes) ? parsed.Processes : parsed?.Processes ? [parsed.Processes] : [];
    const processes = new Map(processRows.map(normalizeProcess).filter(Boolean).map((row) => [row.pid, row]));
    return { state: "available", holderPids, processes };
  } catch (error) {
    return { state: "unavailable", holderPids: [], processes: new Map(), error: error.message };
  }
}
