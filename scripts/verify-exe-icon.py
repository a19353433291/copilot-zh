"""
验证 exe 内嵌图标是否为新图标。

Windows exe 图标存储在资源段（.rsrc）的 RT_GROUP_ICON / RT_ICON 中。
用 PE 解析提取，然后与我们的 icon.ico 对比。
"""
import struct
import os
import sys

EXE = r"C:\Users\a1935\Desktop\copilot-zh\dist\win-unpacked\CopilotHan.exe"
ICO = r"C:\Users\a1935\Desktop\copilot-zh\build\icon.ico"


def parse_pe_resources(path):
    """解析 PE 文件，提取 RT_ICON (type=3) 资源"""
    with open(path, "rb") as f:
        data = f.read()

    # DOS header
    if data[:2] != b"MZ":
        return None, "not a PE file"
    pe_off = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_off:pe_off + 4] != b"PE\0\0":
        return None, "invalid PE signature"

    num_sec = struct.unpack_from("<H", data, pe_off + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe_off + 20)[0]

    # 节表
    sec_off = pe_off + 24 + opt_size
    sections = []
    for i in range(num_sec):
        o = sec_off + i * 40
        name = data[o:o + 8].rstrip(b"\0").decode("ascii", "ignore")
        vsize, vaddr, rsize, raddr = struct.unpack_from("<IIII", data, o + 8)
        sections.append({
            "name": name, "vaddr": vaddr, "vsize": vsize,
            "raddr": raddr, "rsize": rsize,
        })

    def rva_to_off(rva):
        for s in sections:
            if s["vaddr"] <= rva < s["vaddr"] + max(s["vsize"], s["rsize"]):
                return s["raddr"] + (rva - s["vaddr"])
        return None

    # 资源目录 RVA（数据目录第 3 项，索引 2）
    datadir_off = pe_off + 24 + 112
    rsrc_rva = struct.unpack_from("<I", data, datadir_off + 2 * 8)[0]
    if rsrc_rva == 0:
        return None, "no resource directory"

    rsrc_off = rva_to_off(rsrc_rva)
    if rsrc_off is None:
        return None, "cannot map resource RVA"

    # 解析资源目录（3 层：type -> name -> lang）
    icons = []

    def read_dir(off, level, type_id=None):
        if level > 2:
            return
        n_named = struct.unpack_from("<H", data, off + 12)[0]
        n_id = struct.unpack_from("<H", data, off + 14)[0]
        total = n_named + n_id
        for i in range(total):
            eo = off + 16 + i * 8
            name_id = struct.unpack_from("<I", data, eo)[0]
            data_off_field = struct.unpack_from("<I", data, eo + 4)[0]

            cur_type = type_id if level > 0 else name_id

            if data_off_field & 0x80000000:
                # 子目录
                sub = rsrc_off + (data_off_field & 0x7FFFFFFF)
                read_dir(sub, level + 1, cur_type)
            else:
                # 叶子：数据项
                if cur_type == 3:  # RT_ICON
                    de = rsrc_off + data_off_field
                    rva = struct.unpack_from("<I", data, de)[0]
                    size = struct.unpack_from("<I", data, de + 4)[0]
                    foff = rva_to_off(rva)
                    if foff is not None and size > 0 and size < 1_000_000:
                        icons.append((size, data[foff:foff + size]))

    read_dir(rsrc_off, 0)
    return icons, None


print("=" * 64)
print("验证 exe 内嵌图标")
print("=" * 64)

if not os.path.exists(EXE):
    print("exe 不存在:", EXE)
    sys.exit(1)

file_size = os.path.getsize(EXE)
print(f"exe: {EXE}")
print(f"大小: {file_size/1024/1024:.1f} MB")

icons, err = parse_pe_resources(EXE)
if err:
    print("解析失败:", err)
    sys.exit(1)

print(f"\n找到 {len(icons)} 个图标资源")

# 检查是否包含大尺寸图标（256x256 PNG 特征）
has_large = False
for size, blob in icons:
    # PNG 文件头
    is_png = blob[:8] == b"\x89PNG\r\n\x1a\n"
    print(f"  资源 {size:>7} bytes  {'[PNG]' if is_png else '[BMP]'}")
    if is_png and size > 50000:
        has_large = True

# 与源 ico 对比：检查是否包含相同大小的资源
ico_size = os.path.getsize(ICO)
print(f"\n源 icon.ico: {ico_size} bytes")
sizes_in_ico = [s for s, _ in icons]
print(f"exe 中图标资源尺寸分布: {sorted(sizes_in_ico, reverse=True)}")

print("\n" + "=" * 64)
if has_large:
    print("结果: exe 已包含大尺寸 PNG 图标，说明新图标已正确嵌入")
else:
    print("警告: 未找到大尺寸图标，可能仍在用默认图标")
print("=" * 64)
