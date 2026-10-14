"""Enumerate the installed OpenCL runtime. No kernel or context is created."""
import ctypes as c
import json
from pathlib import Path

result = {"scope": "Installed OpenCL capability enumeration only; no rendering or compute performance measured", "platforms": []}
try:
    runtime = c.WinDLL("OpenCL.dll")
    def function(name, arguments):
        value = getattr(runtime, name)
        value.argtypes, value.restype = arguments, c.c_int
        return value
    platforms = function("clGetPlatformIDs", [c.c_uint, c.POINTER(c.c_void_p), c.POINTER(c.c_uint)])
    devices = function("clGetDeviceIDs", [c.c_void_p, c.c_uint64, c.c_uint, c.POINTER(c.c_void_p), c.POINTER(c.c_uint)])
    platform_info = function("clGetPlatformInfo", [c.c_void_p, c.c_uint, c.c_size_t, c.c_void_p, c.POINTER(c.c_size_t)])
    device_info = function("clGetDeviceInfo", [c.c_void_p, c.c_uint, c.c_size_t, c.c_void_p, c.POINTER(c.c_size_t)])
    def info(query, identifier, parameter):
        size = c.c_size_t()
        status = query(identifier, parameter, 0, None, c.byref(size))
        if status:
            return {"error": status}
        if size.value > 1024 * 1024:
            return {"error": "CAPABILITY_SIZE_LIMIT"}
        buffer = c.create_string_buffer(size.value)
        status = query(identifier, parameter, size.value, buffer, None)
        return buffer.value.decode("utf-8", "replace") if not status else {"error": status}
    count = c.c_uint()
    result["platformStatus"] = platforms(0, None, c.byref(count))
    if result["platformStatus"] == 0:
        if count.value > 64:
            raise ValueError("Too many OpenCL platforms")
        identifiers = (c.c_void_p * count.value)()
        status = platforms(count.value, identifiers, None)
        if status:
            raise ValueError(f"Platform enumeration failed: {status}")
        for identifier in identifiers:
            platform = {"name": info(platform_info, identifier, 0x0902), "vendor": info(platform_info, identifier, 0x0903), "version": info(platform_info, identifier, 0x0901), "devices": []}
            count_devices = c.c_uint()
            platform["deviceStatus"] = devices(identifier, 0xFFFFFFFF, 0, None, c.byref(count_devices))
            if platform["deviceStatus"] == 0:
                if count_devices.value > 64:
                    raise ValueError("Too many OpenCL devices")
                device_ids = (c.c_void_p * count_devices.value)()
                status = devices(identifier, 0xFFFFFFFF, count_devices.value, device_ids, None)
                if status:
                    raise ValueError(f"Device enumeration failed: {status}")
                for device in device_ids:
                    extensions = info(device_info, device, 0x1030)
                    names = ["cl_khr_device_uuid", "cl_khr_external_memory", "cl_khr_external_memory_win32", "cl_khr_external_semaphore", "cl_khr_external_semaphore_win32"]
                    platform["devices"].append({"name": info(device_info, device, 0x102B), "vendor": info(device_info, device, 0x102C), "version": info(device_info, device, 0x102F), "driver": info(device_info, device, 0x102D), "openclC": info(device_info, device, 0x103D), "interop": {name: name in extensions.split() for name in names} if isinstance(extensions, str) else extensions})
            result["platforms"].append(platform)
except (OSError, ValueError) as error:
    result["error"] = str(error)
output = Path(__file__).resolve().parents[2] / "evidence" / "opencl-installed-capabilities.json"
output.write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result, indent=2))
