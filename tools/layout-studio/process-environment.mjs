/** Explicit desktop/OS coordinates; no provider keys or runtime injection. */
export function desktopEnvironment(source = process.env) {
  const allowed = new Set(["PATH", "HOME", "USER", "LOGNAME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "LOCALAPPDATA", "APPDATA", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "OS", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMMONPROGRAMW6432", "ALLUSERSPROFILE", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "PROCESSOR_IDENTIFIER", "USERNAME", "USERDOMAIN", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XDG_STATE_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_CURRENT_DESKTOP", "DBUS_SESSION_BUS_ADDRESS", "HYPRLAND_INSTANCE_SIGNATURE"]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toUpperCase())));
}

/** Only the fixed native helper needs the current user's .NET extraction temp. */
export function windowsHelperTemporaryEnvironment(source = process.env) {
  const values = new Map();
  for (const [key,value] of Object.entries(source)) if (["TEMP","TMP"].includes(key.toUpperCase())) {
    const name=key.toUpperCase();if(values.has(name)&&values.get(name)!==value)throw Error("The Windows helper temporary directory is ambiguous.");values.set(name,value);
  }
  const root=values.get("TMP")||values.get("TEMP");
  if(typeof root!=="string"||root.length>2048||!/^[A-Za-z]:[\\/]/.test(root)||/[\x00-\x1f\x7f]/.test(root)||root.slice(2).includes(":")||root.split(/[\\/]/).some(part=>part==="."||part===".."))throw Error("The Windows helper requires an exact current-user temporary directory.");
  return {TEMP:root,TMP:root};
}
