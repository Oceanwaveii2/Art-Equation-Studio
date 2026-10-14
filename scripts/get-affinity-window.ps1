Add-Type @'
  using System;
  using System.Runtime.InteropServices;
  using System.Text;
  public class WinApi {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
  }
'@

[WinApi]::EnumWindows({
  param($hwnd, $lparam)
  $procId = 0
  [WinApi]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
  $sb = New-Object System.Text.StringBuilder 256
  [WinApi]::GetWindowText($hwnd, $sb, 256) | Out-Null
  $title = $sb.ToString()
  if ($title -ne '' -and [WinApi]::IsWindowVisible($hwnd)) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc.ProcessName -match 'Affinity|Photo|Illustrator|Designer') {
      Write-Output "PID: $procId | Name: $($proc.ProcessName) | HWND: $hwnd | Title: $title"
    }
  }
  return $true
}, [IntPtr]::Zero)
