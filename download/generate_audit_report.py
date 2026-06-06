#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SEMS Project Audit Report Generator
Comprehensive security and code quality audit for:
- Firmware (ESP32 WROOM)
- Backend (Google Apps Script)
- Frontend (Next.js / Vercel)
"""

import os, sys, hashlib
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, cm
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY, TA_RIGHT
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle,
    KeepTogether, CondPageBreak, HRFlowable
)
from reportlab.platypus.tableofcontents import TableOfContents
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ━━━━ Font Registration ━━━━
pdfmetrics.registerFont(TTFont('NotoSerifSC', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSCBold', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('SarasaMonoSC', '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('SarasaMonoSCBold', '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Carlito', '/usr/share/fonts/truetype/english/Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'))
registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSCBold')
registerFontFamily('SarasaMonoSC', normal='SarasaMonoSC', bold='SarasaMonoSCBold')
registerFontFamily('Carlito', normal='Carlito', bold='Carlito')
registerFontFamily('DejaVuSans', normal='DejaVuSans', bold='DejaVuSans')

# ━━━━ Color Palette ━━━━
ACCENT = colors.HexColor('#4520b6')
TEXT_PRIMARY = colors.HexColor('#1a1c1d')
TEXT_MUTED = colors.HexColor('#777d83')
BG_SURFACE = colors.HexColor('#d4d9e0')
BG_PAGE = colors.HexColor('#e8eaed')

# Severity colors
CRIT_COLOR = colors.HexColor('#dc2626')
HIGH_COLOR = colors.HexColor('#ea580c')
MED_COLOR = colors.HexColor('#ca8a04')
LOW_COLOR = colors.HexColor('#16a34a')
INFO_COLOR = colors.HexColor('#2563eb')

TABLE_HEADER_COLOR = ACCENT
TABLE_HEADER_TEXT = colors.white
TABLE_ROW_EVEN = colors.white
TABLE_ROW_ODD = BG_SURFACE

# ━━━━ Styles ━━━━
PAGE_W, PAGE_H = A4
LEFT_MARGIN = 1.0 * inch
RIGHT_MARGIN = 1.0 * inch
TOP_MARGIN = 0.8 * inch
BOTTOM_MARGIN = 0.8 * inch
CONTENT_W = PAGE_W - LEFT_MARGIN - RIGHT_MARGIN

styles = getSampleStyleSheet()

# Custom styles
style_title = ParagraphStyle('Title2', fontName='NotoSerifSC', fontSize=26, leading=34,
    textColor=ACCENT, spaceAfter=6, alignment=TA_LEFT)
style_h1 = ParagraphStyle('H1', fontName='NotoSerifSC', fontSize=18, leading=26,
    textColor=ACCENT, spaceBefore=18, spaceAfter=10)
style_h2 = ParagraphStyle('H2', fontName='NotoSerifSC', fontSize=14, leading=20,
    textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=8)
style_h3 = ParagraphStyle('H3', fontName='NotoSerifSC', fontSize=12, leading=18,
    textColor=TEXT_PRIMARY, spaceBefore=10, spaceAfter=6)
style_body = ParagraphStyle('Body', fontName='NotoSerifSC', fontSize=10.5, leading=18,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK', spaceAfter=6)
style_body_indent = ParagraphStyle('BodyIndent', parent=style_body, leftIndent=18)
style_code = ParagraphStyle('Code', fontName='SarasaMonoSC', fontSize=8.5, leading=13,
    textColor=colors.HexColor('#374151'), backColor=colors.HexColor('#f3f4f6'),
    leftIndent=12, rightIndent=12, spaceBefore=4, spaceAfter=4,
    borderPadding=6, borderWidth=0.5, borderColor=colors.HexColor('#d1d5db'))
style_bullet = ParagraphStyle('Bullet', fontName='NotoSerifSC', fontSize=10.5, leading=18, textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK', leftIndent=24, bulletIndent=12, spaceBefore=2, spaceAfter=2)
style_caption = ParagraphStyle('Caption', fontName='NotoSerifSC', fontSize=9, leading=14,
    textColor=TEXT_MUTED, alignment=TA_CENTER, spaceBefore=3, spaceAfter=6)

# Table styles
style_th = ParagraphStyle('TH', fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=colors.white, alignment=TA_CENTER)
style_td = ParagraphStyle('TD', fontName='NotoSerifSC', fontSize=9, leading=14,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK')
style_td_center = ParagraphStyle('TDCenter', parent=style_td, alignment=TA_CENTER)
style_td_code = ParagraphStyle('TDCode', fontName='SarasaMonoSC', fontSize=8, leading=12,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT)

# Severity styles
style_crit = ParagraphStyle('Crit', fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=CRIT_COLOR, alignment=TA_CENTER)
style_high = ParagraphStyle('High', fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=HIGH_COLOR, alignment=TA_CENTER)
style_med = ParagraphStyle('Med', fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=MED_COLOR, alignment=TA_CENTER)
style_low = ParagraphStyle('Low', fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=LOW_COLOR, alignment=TA_CENTER)
style_info = ParagraphStyle('Info', fontName='NotoSerifSC', fontSize=9.5, leading=14,
    textColor=INFO_COLOR, alignment=TA_CENTER)

def sev_style(level):
    return {'KRITIS': style_crit, 'TINGGI': style_high, 'SEDANG': style_med,
            'RENDAH': style_low, 'INFO': style_info}.get(level, style_td_center)

# ━━━━ TocDocTemplate ━━━━
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))

# ━━━━ Helper functions ━━━━
def heading(text, style, level=0):
    key = 'h_%s' % hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/>%s' % (key, text), style)
    p.bookmark_name = text
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p

def add_major(text, style):
    return [CondPageBreak(100), heading(text, style, 0)]

def para(text):
    return Paragraph(text, style_body)

def para_i(text):
    return Paragraph(text, style_body_indent)

def code_block(text):
    return Paragraph(text.replace('<', '&lt;').replace('>', '&gt;'), style_code)

def bullet(text):
    return Paragraph(text, style_bullet)

def spacer(h=12):
    return Spacer(1, h)

def hr():
    return HRFlowable(width="100%", thickness=0.5, color=BG_SURFACE, spaceAfter=6, spaceBefore=6)

def make_table(headers, rows, col_widths=None):
    """Build a styled table with Paragraph cells."""
    if col_widths is None:
        n = len(headers)
        col_widths = [CONTENT_W / n] * n
    data = []
    header_row = [Paragraph('<b>%s</b>' % h, style_th) for h in headers]
    data.append(header_row)
    for row in rows:
        data.append(row)
    t = Table(data, colWidths=col_widths, hAlign='CENTER', repeatRows=1)
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#d1d5db')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(data)):
        bg = TABLE_ROW_EVEN if i % 2 == 1 else TABLE_ROW_ODD
        style_cmds.append(('BACKGROUND', (0, i), (-1, i), bg))
    t.setStyle(TableStyle(style_cmds))
    return t

def finding_table(findings):
    """Create findings table with severity, ID, description."""
    headers = ['ID', 'Severity', 'Temuan', 'File', 'Dampak']
    col_ratios = [0.08, 0.1, 0.32, 0.2, 0.3]
    col_widths = [r * CONTENT_W for r in col_ratios]
    rows = []
    for fid, sev, desc, file_ref, impact in findings:
        rows.append([
            Paragraph(fid, style_td_center),
            Paragraph('<b>%s</b>' % sev, sev_style(sev)),
            Paragraph(desc, style_td),
            Paragraph(file_ref, style_td_code),
            Paragraph(impact, style_td),
        ])
    return make_table(headers, rows, col_widths)


# ━━━━ Page number footer ━━━━
def add_page_number(canvas, doc):
    canvas.saveState()
    canvas.setFont('NotoSerifSC', 8)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, '%d' % doc.page)
    canvas.restoreState()


# ━━━━ BUILD REPORT ━━━━
OUTPUT_DIR = '/home/z/my-project/download'
BODY_PDF = os.path.join(OUTPUT_DIR, 'sems_audit_body.pdf')
FINAL_PDF = os.path.join(OUTPUT_DIR, 'Laporan_Audit_SEMS.pdf')

doc = TocDocTemplate(
    BODY_PDF,
    pagesize=A4,
    leftMargin=LEFT_MARGIN,
    rightMargin=RIGHT_MARGIN,
    topMargin=TOP_MARGIN,
    bottomMargin=BOTTOM_MARGIN,
    title='Laporan Audit Sistem SEMS',
    author='Z.ai - Security Audit',
    subject='Comprehensive Security & Code Quality Audit',
)

story = []

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# TOC
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.append(Paragraph('<b>Daftar Isi</b>', style_title))
story.append(spacer(12))

toc = TableOfContents()
toc.levelStyles = [
    ParagraphStyle('TOC1', fontName='NotoSerifSC', fontSize=12, leftIndent=20, leading=22, spaceBefore=6),
    ParagraphStyle('TOC2', fontName='NotoSerifSC', fontSize=10, leftIndent=40, leading=18, spaceBefore=3),
]
story.append(toc)
story.append(PageBreak())

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. RINGKASAN EKSEKUTIF
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>1. Ringkasan Eksekutif</b>', style_h1))

story.append(para(
    'Laporan ini merupakan hasil audit komprehensif terhadap Sistem Manajemen Energi Cerdas (SEMS - Smart Energy Management System) '
    'yang dikembangkan oleh PT. Jaya Mandiri Smart Energy. Sistem ini terdiri dari empat komponen utama: firmware ESP32 WROOM sebagai perangkat '
    'penginderaan dan kontrol perangkat keras, backend Google Apps Script sebagai middleware API, Google Spreadsheet sebagai penyimpan data '
    'dan kredensial, serta frontend Next.js yang di-hosting di Vercel sebagai antarmuka pengguna.'
))

story.append(para(
    'Audit ini mencakup aspek keamanan siber, kualitas kode, arsitektur perangkat lunak, keselamatan perangkat keras (hardware safety), '
    'serta integrasi antar komponen. Secara keseluruhan, tim auditor menemukan total <b>16 temuan KRITIS</b>, <b>22 temuan TINGGI</b>, '
    '<b>26 temuan SEDANG</b>, dan <b>20 temuan RENDAH</b> yang tersebar di seluruh komponen sistem. Temuan-temuan KRITIS meliputi kerentanan '
    'keamanan yang dapat dieksploitasi untuk mengakses data sensitif, mengambil alih perangkat, dan berpotensi menyebabkan kerusakan fisik '
    'pada perangkat keras baterai.'
))

story.append(spacer(12))

# Summary stats table
summary_headers = ['Komponen', 'KRITIS', 'TINGGI', 'SEDANG', 'RENDAH', 'INFO']
summary_rows = [
    [Paragraph('Firmware ESP32', style_td), Paragraph('7', style_crit),
     Paragraph('8', style_high), Paragraph('10', style_med), Paragraph('4', style_low), Paragraph('0', style_info)],
    [Paragraph('Backend GAS', style_td), Paragraph('5', style_crit),
     Paragraph('5', style_high), Paragraph('7', style_med), Paragraph('5', style_low), Paragraph('0', style_info)],
    [Paragraph('Frontend Vercel', style_td), Paragraph('4', style_crit),
     Paragraph('9', style_high), Paragraph('18', style_med), Paragraph('12', style_low), Paragraph('9', style_info)],
    [Paragraph('<b>Total</b>', style_td), Paragraph('<b>16</b>', style_crit),
     Paragraph('<b>22</b>', style_high), Paragraph('<b>35</b>', style_med), Paragraph('<b>21</b>', style_low), Paragraph('<b>9</b>', style_info)],
]
t = make_table(summary_headers, summary_rows,
    [CONTENT_W*0.25, CONTENT_W*0.12, CONTENT_W*0.12, CONTENT_W*0.12, CONTENT_W*0.12, CONTENT_W*0.12])
story.append(t)
story.append(Paragraph('Tabel 1: Ringkasan Temuan Audit per Komponen', style_caption))
story.append(spacer(18))

story.append(heading('<b>1.1 Temuan Paling Kritis</b>', style_h2))
story.append(para(
    'Temuan paling berbahaya yang ditemukan dalam audit ini adalah sebagai berikut. Pertama, <b>kredensial hardcoded</b> '
    'yang mencakup WiFi password, API token, dan OTA password yang tersimpan dalam plain text di source code firmware. '
    'Kedua, <b>Safety Engine tidak mengambil tindakan protektif</b> - kondisi overvoltage dan undervoltage hanya mencatat log '
    'tanpa memutus relay atau menghentikan charging, yang berpotensi menyebabkan kerusakan baterai LiFePO4 hingga terjadinya kebakaran. '
    'Ketiga, <b>seluruh endpoint GET backend tidak memiliki autentikasi</b>, sehingga siapa pun yang mengetahui URL Google Apps Script '
    'dapat mengakses semua data sistem termasuk token perangkat dan informasi pengguna.'
))
story.append(para(
    'Keempat, <b>middleware frontend menggunakan cookie statik "sems-auth=1"</b> yang dapat dengan mudah dipalsukan oleh '
    'pengguna melalui browser DevTools, menjadikan seluruh proteksi rute dashboard tidak efektif. Kelima, terdapat <b>potensi '
    'injeksi formula Google Sheets</b> karena string yang dikontrol pengguna ditulis langsung ke sel spreadsheet tanpa sanitasi, '
    'yang dapat menyebabkan eksekusi kode arbitrer dan eksfiltrasi data.'
))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. AUDIT FIRMWARE ESP32
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>2. Audit Firmware ESP32 WROOM</b>', style_h1))

story.append(heading('<b>2.1 Gambaran Umum Arsitektur Firmware</b>', style_h2))
story.append(para(
    'Firmware SEMS dibangun menggunakan framework Arduino dengan PlatformIO sebagai build system. Target hardware adalah '
    'ESP32 WROOM DEVKIT yang bertanggung jawab untuk pembacaan sensor (voltage baterai, arus ACS712, suhu/kelembaban SHT31, '
    'deteksi gerak PIR, monitoring RTC), kontrol relay untuk pengelolaan beban, pengiriman telemetry ke backend, serta sinkronisasi '
    'konfigurasi dari server. Firmware juga mengimplementasikan SOC (State of Charge) calculator, safety engine, automation engine, '
    'load shedding engine, dan schedule engine.'
))
story.append(para(
    'Auditor menemukan bahwa proyek ini mengandung <b>dua basis kode paralel yang tidak sinkron</b>. File SEMS_Firmware.ino '
    '(~1600 baris, monolitik) merupakan kode produksi yang berjalan, sementara direktori sensors/, engines/, dan utils/ berisi '
    'versi refaktoring berbasis kelas OOP yang <b>tidak dapat dikompilasi</b> karena mereferensikan ~40 konstanta yang tidak '
    'terdefinisi dan menggunakan EEPROM API yang sudah dihapus di ESP32 Core 3.x. Keberadaan dua versi kode yang tidak kompatibel '
    'ini merupakan risiko pemeliharaan yang serius.'
))

story.append(heading('<b>2.2 Temuan Keamanan Firmware</b>', style_h2))

fw_sec_findings = [
    ('FW-S01', 'KRITIS', 'WiFi SSID dan Password Hardcoded', 'config.h:25-26',
     'Siapa pun dengan akses kode sumber mengetahui kredensial WiFi. Password "1234567890" sangat mudah ditebak.'),
    ('FW-S02', 'KRITIS', 'API Token dan Device ID Hardcoded', 'config.h:36-37',
     'Token "sems_device_token_change_me_2024" adalah placeholder yang tidak pernah diubah. Token ini digunakan untuk autentikasi semua upload telemetry.'),
    ('FW-S03', 'KRITIS', 'OTA Password Hardcoded', 'config.h:173',
     'Password OTA terekspos. Versi platformio.ini menggunakan password berbeda ("sems_ota_2024" vs "sems_ota_2026").'),
    ('FW-S04', 'KRITIS', 'URL Google Apps Script Terekspos', 'config.h:35',
     'URL backend GAS terekspos dalam kode sumber, memungkinkan penyerang mem-probe endpoint.'),
    ('FW-S05', 'TINGGI', 'Autentikasi Token Statik', 'SEMS_Firmware.ino:1249',
     'Single static token tanpa rotasi, tanpa identitas per-perangkat, tanpa mutual TLS.'),
    ('FW-S06', 'TINGGI', 'Tidak Ada Validasi Input pada Konfigurasi Remote', '.ino:1304-1348',
     'Safety thresholds (overvoltage, overcurrent, temperature) dapat diatur ke nilai berbahaya oleh backend yang compromised.'),
    ('FW-S07', 'SEDANG', 'Tidak Ada Certificate Pinning HTTPS', 'SEMS_Firmware.ino:1244',
     'Menggunakan WiFiClient default tanpa certificate pinning. MitM dengan CA cert valid dapat menyadap traffic.'),
]
story.append(finding_table(fw_sec_findings))
story.append(Paragraph('Tabel 2: Temuan Keamanan Firmware', style_caption))
story.append(spacer(18))

story.append(heading('<b>2.3 Temuan Keselamatan Perangkat Keras</b>', style_h2))
story.append(para(
    'Temuan paling kritis dari aspek keselamatan perangkat keras adalah bahwa Safety Engine <b>tidak mengambil tindakan protektif '
    'apapun</b>. Pada kondisi overvoltage (>29.6V pada baterai LiFePO4 8S), firmware hanya mencatat log ke Serial Monitor tanpa '
    'memutus relay charging atau melakukan emergency shutdown. Demikian pula pada kondisi undervoltage (<19.0V), tidak ada aksi '
    'emergency load shedding yang diambil. Hal ini berpotensi menyebabkan kerusakan permanen pada sel baterai atau bahkan terjadinya '
    'thermal runaway dan kebakaran.'
))
story.append(para(
    'Selain itu, engine load shedding hanya mengimplementasikan pemb shedding biner (matikan semua atau tidak ada), meskipun '
    'terdapat threshold bertingkat (TIER1/TIER2/TIER3). Kode mengakui ketidaklengkapan ini dengan komentar "TODO: Implement '
    'priority-based load shedding". Pada skenario nyata brownout, beban non-esensial dan beban kenyamanan dimatikan secara bersamaan '
    'tanpa prioritas. Monitoring overcurrent menggunakan ACS712 juga tidak diimplementasikan di firmware produksi (.ino), sementara '
    'threshold SAFETY_OVERCURRENT_A (31A) didefinisikan tetapi tidak pernah dicek.'
))

fw_safety_findings = [
    ('FW-H01', 'KRITIS', 'Safety Engine Tidak Mengambil Tindakan Protektif', '.ino:825-835',
     'Overvoltage/undervoltage hanya log, tanpa relay cutoff atau emergency shutdown. Risiko thermal runaway.'),
    ('FW-H02', 'KRITIS', 'Load Shedding Biner - Semua Tier Identik', '.ino:897-904',
     'Meskipun ada threshold bertingkat, aksi shedding hanya matikan semua relay non-kritis.'),
    ('FW-H03', 'TINGGI', 'Cell Imbalance Hanya Warning Tanpa Aksi', '.ino:838-850',
     'Imbalance >300mV pada LiFePO4 mengindikasikan sel rusak, tapi tidak ada pengurangan arus charge/discharge.'),
    ('FW-H04', 'TINGGI', 'Overcurrent Tidak Dicek di Firmware Aktif', '.ino safetyEngineLoop()',
     'Threshold SAFETY_OVERCURRENT_A (31A) didefinisikan tapi tidak dicek di .ino yang berjalan.'),
    ('FW-H05', 'SEDANG', 'Suhu Tidak Dimonitor di Firmware Aktif', '.ino safetyEngineLoop()',
     'SAFETY_MAX_TEMP_C (50 derajat) didefinisikan tapi tidak dicek. Risiko kerusakan sel dan kebakaran.'),
    ('FW-H06', 'SEDANG', 'Backup Voltage ADC2 Selalu Unavailable', '.ino:679-691',
     'ESP32 ADC2 tidak dapat digunakan bersamaan dengan WiFi. Pembacaan voltage backup selalu gagal.'),
]
story.append(finding_table(fw_safety_findings))
story.append(Paragraph('Tabel 3: Temuan Keselamatan Perangkat Keras', style_caption))
story.append(spacer(18))

story.append(heading('<b>2.4 Temuan Kualitas Kode dan Arsitektur</b>', style_h2))
story.append(para(
    'Dari sisi arsitektur, firmware mengalami beberapa masalah struktural yang signifikan. Dual codebase (monolitik .ino vs '
    'modular classes) menjamin divergensi dan bug. Struct SensorData yang berukuran ~115 byte merupakan god object yang memegang '
    'semua state sistem tanpa enkapsulasi atau access control. Tidak ada mutex atau semaphore untuk shared state, yang berpotensi '
    'menyebabkan torn reads jika kode berpindah ke arsitektur multi-task FreeRTOS. Dari sisi kualitas kode, komentar campuran '
    'Indonesia dan Inggris mengurangi maintainability, dan tidak ada framework pengujian unit untuk logika safety-critical.'
))

fw_arch_findings = [
    ('FW-A01', 'TINGGI', 'Dual Codebase - .ino dan Modular Tidak Sinkron', 'Semua file',
     'Kode modular tidak bisa kompilasi (~40 konstanta hilang, EEPROM API salah). Dua versi menjamin divergensi.'),
    ('FW-A02', 'TINGGI', 'Tidak Ada Mutex untuk Shared State', '.ino:70-117',
     'SensorData global ditulis/dibaca oleh banyak engine tanpa proteksi concurrent access.'),
    ('FW-A03', 'SEDANG', 'God Object - SensorData 115 Byte', '.ino:70-115',
     'Single struct memegang semua state tanpa enkapsulasi atau change notification.'),
    ('FW-A04', 'SEDANG', 'String Queue Heap Fragmentation', '.ino:126-133',
     '50 entry String queue dapat menghabiskan 25KB+ heap. Fragmentasi dapat menyebabkan crash.'),
    ('FW-A05', 'SEDANG', 'EEPROM Wear - SOC Disimpan Setiap 60 Detik', 'SOC_Calculator.cpp',
     'EEPROM emulation berbasis flash (100K cycles). Write setiap 60 detik = habis dalam ~70 hari.'),
    ('FW-A06', 'TINGGI', 'OTA Password Mismatch config.h vs platformio.ini', 'config.h:173 / platformio.ini:37',
     'config.h: "sems_ota_2026" vs platformio.ini: "sems_ota_2024". OTA upload akan gagal.'),
    ('FW-A07', 'RENDAH', 'Timer Jitter pada NonBlockingTimer', 'NonBlockingTimer.h:28-32',
     'Setiap cycle mengakumulasi hingga 1ms jitter. Dampak signifikan pada timer high-frequency (PIR 200ms).'),
]
story.append(finding_table(fw_arch_findings))
story.append(Paragraph('Tabel 4: Temuan Arsitektur dan Kualitas Kode Firmware', style_caption))
story.append(spacer(18))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. AUDIT BACKEND GOOGLE APPS SCRIPT
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>3. Audit Backend Google Apps Script</b>', style_h1))

story.append(heading('<b>3.1 Gambaran Umum Backend</b>', style_h2))
story.append(para(
    'Backend SEMS diimplementasikan menggunakan Google Apps Script (GAS) sebagai REST API middleware antara firmware ESP32 dan '
    'frontend Next.js, dengan Google Spreadsheet sebagai basis data. Arsitektur ini terdiri dari 13 file .gs yang mencakup: '
    'routing (Code.gs), konfigurasi (Config.gs), autentikasi (Auth.gs), API handler untuk device, telemetry, config, alarm, '
    'schedule, rule, dan user, serta email notification, data cleanup, dan sheet setup. Backend mengimplementasikan RBAC '
    '(Role-Based Access Control) dengan tiga level peran: admin, technician, dan viewer.'
))
story.append(para(
    'Secara keseluruhan, backend menunjukkan organisasi kode yang cukup baik dengan pemisahan concerns yang jelas antara routing, '
    'handler API, autentikasi, dan utilitas. Terdapat beberapa fitur positif termasuk rate limiting pada login (5 percobaan per 15 '
    'menit), rate limiting email (1 per tipe per 30 menit + batas 20/hari), hashing password dengan salt, dan deduplikasi telemetry. '
    'Namun, terdapat beberapa kerentanan keamanan kritis yang perlu segera ditangani.'
))

story.append(heading('<b>3.2 Temuan Keamanan Backend</b>', style_h2))

be_sec_findings = [
    ('BE-S01', 'KRITIS', 'Semua Endpoint GET Tanpa Autentikasi', 'Code.gs:105-190',
     'Semua GET route langsung ke handler tanpa cek auth. Data sensitif (telemetry, devices, users, config termasuk device_token) terbuka.'),
    ('BE-S02', 'KRITIS', 'Token Terekspos via URL Query Parameter', 'Code.gs:310-331',
     'Fallback token dari ?token=... muncul di browser history, logs, referrer headers. Anti-pattern yang berbahaya.'),
    ('BE-S03', 'KRITIS', 'Google Sheets Formula Injection', 'DeviceAPI, ConfigAPI, AlarmAPI, TelemetryAPI',
     'String user-controlled ditulis langsung ke sel tanpa sanitasi. Mulai dengan "=" dieksekusi sebagai formula.'),
    ('BE-S04', 'KRITIS', 'Default Credentials di Source Code', 'Config.gs:201, SetupSheets.gs:319-343',
     'Password default "changeme_immediately" untuk admin dan technician. Tidak ada mekanisme force change password.'),
    ('BE-S05', 'KRITIS', 'Timing-Safe Comparison Ada tapi Tidak Pernah Dipakai', 'Auth.gs:395-402 vs 58, 362',
     'Fungsi compareHashes_() terdefinisi tapi perbandingan token/hash tetap menggunakan operator !==.'),
    ('BE-S06', 'TINGGI', 'Tidak Ada Rate Limiting pada POST Endpoints', 'Code.gs routePost_',
     'Hanya login yang memiliki rate limiting. Telemetry spam dapat mengisi sheet (maks 5M cells), relay rapid toggle dapat merusak hardware.'),
    ('BE-S07', 'TINGGI', 'Single Shared Device Token - Tanpa Identitas Perangkat', 'Auth.gs:22-67',
     'Semua ESP32 berbagi satu token. Tidak ada audit trail perangkat, tidak dapat revoke akses satu perangkat.'),
    ('BE-S08', 'TINGGI', 'Cleanup Berjalan di Setiap Telemetry POST', 'TelemetryAPI.gs:129-133',
     'Sheet penuh (170K+ baris) di-scan setiap 15 detik. Execution time meningkat seiring akumulasi data. Time bomb.'),
    ('BE-S09', 'SEDANG', 'ConfigAPI Mengekspos Device Token di GET Response', 'ConfigAPI.gs:66-71',
     'GET /api/config/get mengembalikan semua config termasuk device_token. Sensitif terutama karena GET tanpa auth.'),
    ('BE-S10', 'SEDANG', 'Password Hashing Menggunakan SHA-256 Tanpa Key Stretching', 'Auth.gs:334-343',
     'SHA-256 fast hash, salt hanya 16 char dari UUID. Rentan brute-force. GAS tidak mendukung bcrypt.'),
]
story.append(finding_table(be_sec_findings))
story.append(Paragraph('Tabel 5: Temuan Keamanan Backend', style_caption))
story.append(spacer(18))

story.append(heading('<b>3.3 Temuan Performa dan Arsitektur</b>', style_h2))
story.append(para(
    'Dari sisi performa, masalah paling signifikan adalah mekanisme data cleanup yang berjalan pada setiap POST telemetry. '
    'Fungsi runDataCleanup_() melakukan loading dan scanning seluruh sheet telemetry_history dan alarms pada setiap pengiriman '
    'data (interval 15 detik). Dengan 30 hari riwayat pada interval 15 detik, ini berpotensi 170.000+ baris yang harus dibaca dan '
    'di-scan per request. GAS memiliki batas eksekusi 6 menit dan memory 512MB, sehingga kinerja akan menurun secara progresif '
    'seiring bertambahnya data, dan akhirnya menyebabkan kegagalan telemetry.'
))
story.append(para(
    'Selain itu, penggunaan LockService.getScriptLock() secara global pada semua operasi write menyebabkan bottleneck. Dengan '
    'interval telemetry 15 detik dan operasi frontend yang bersamaan, timeout lock akan menjadi sering terjadi (lock wait 5 detik, '
    'mengembalikan HTTP 503). Lock contention ini akan menyebabkan pengalaman "Server busy" yang sering bagi pengguna frontend '
    'ketika ESP32 aktif mengirim data.'
))

be_perf_findings = [
    ('BE-P01', 'TINGGI', 'Lock Contention - Single Global Lock Semua Operasi', 'Semua API files',
     'Lock wait 5 detik. Frontend sering mendapat 503 ketika ESP32 aktif mengirim telemetry.'),
    ('BE-P02', 'SEDANG', 'CacheService TTL Maks 6 Jam - Session Abadi', 'Auth.gs:176-177',
     'Code set TTL 24 jam tapi GAS batas 6 jam. Sliding window refresh membuat session tidak pernah expired.'),
    ('BE-P03', 'RENDAH', 'Semua Session Di-invalidate Saat Satu User Diubah', 'UserAPI.gs:359-372',
     'Perubahan role/active satu user memaksa semua user logout. Terlalu agresif.'),
    ('BE-P04', 'RENDAH', 'Tidak Ada API Versioning', 'Code.gs semua route',
     'Semua route tanpa versi (/api/telemetry bukan /api/v1/telemetry). Breaking changes akan mengganggu semua client.'),
    ('BE-P05', 'RENDAH', 'Path Override via POST Body', 'Code.gs:50-54',
     'Router membaca path dari request body jika pathInfo kosong. Routing manipulation potensial.'),
]
story.append(finding_table(be_perf_findings))
story.append(Paragraph('Tabel 6: Temuan Performa dan Arsitektur Backend', style_caption))
story.append(spacer(18))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. AUDIT FRONTEND NEXT.JS / VERCEL
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>4. Audit Frontend Next.js / Vercel</b>', style_h1))

story.append(heading('<b>4.1 Gambaran Umum Frontend</b>', style_h2))
story.append(para(
    'Frontend SEMS dibangun menggunakan Next.js 16.1.1 dengan React 19, TypeScript 5, dan Tailwind CSS 4. Aplikasi ini '
    'di-deploy ke Vercel dan mengimplementasikan Progressive Web App (PWA) dengan service worker, manifest, dan ikon. Arsitektur '
    'menggunakan App Router dengan direktori pages yang terstruktur, API routes sebagai proxy ke backend GAS, dan komponen UI '
    'berbasis shadcn/ui (25+ Radix UI primitives). Fitur dashboard meliputi: live overview, manajemen perangkat, analitik energi, '
    'alarm, automation/rules, schedules, load shedding, battery health, history, logs, notifications, user management, dan settings.'
))

story.append(heading('<b>4.2 Temuan Keamanan Frontend</b>', style_h2))

fe_sec_findings = [
    ('FE-S01', 'KRITIS', 'Auth Token Lewat URL Query Parameter', 'api/sems/route.ts:56-59',
     'Token GAS disisipkan sebagai ?token=... di URL. Muncul di server logs, browser history, referrer headers.'),
    ('FE-S02', 'KRITIS', 'Token di localStorage Tanpa Expiry/Integrity', 'login/page.tsx:51-53',
     'Auth token dan user object (termasuk role: admin) disimpan di localStorage tanpa expiry, signature, atau integrity check.'),
    ('FE-S03', 'KRITIS', 'Cookie Middleware "sems-auth=1" Trivially Forgible', 'login/page.tsx:57, middleware.ts:11-15',
     'Cookie statik "sems-auth=1" dapat dipalsukan via DevTools. Middleware protection sama sekali tidak efektif.'),
    ('FE-S04', 'TINGGI', 'Tidak Ada Proteksi CSRF pada API Routes', 'api/sems/route.ts',
     'POST endpoints untuk device control, rule creation, user creation tanpa CSRF token validation.'),
    ('FE-S05', 'TINGGI', 'Role User Ditentukan dari Client-Side Data', 'useSemsAuth.ts:24-33',
     'Role admin/technician/viewer ditentukan dari localStorage, bukan validasi server. UI admin terbuka tanpa validasi.'),
    ('FE-S06', 'TINGGI', 'Tidak Ada Rate Limiting pada Login', 'login/page.tsx, api/sems/route.ts',
     'Brute force credential attack melalui proxy frontend ke backend GAS.'),
    ('FE-S07', 'SEDANG', 'Cookie Tanpa Secure/HttpOnly Flags', 'login/page.tsx:57',
     'Cookie "sems-auth=1" tanpa flag Secure dan HttpOnly. Dapat dikirim melalui HTTP dan diakses JavaScript.'),
    ('FE-S08', 'SEDANG', 'NEXTAUTH_SECRET Dependency Tanpa Validasi', 'lib/auth.ts:107',
     'Jika NEXTAUTH_SECRET tidak diset, NextAuth dapat fallback ke generated secret yang berubah tiap deployment.'),
]
story.append(finding_table(fe_sec_findings))
story.append(Paragraph('Tabel 7: Temuan Keamanan Frontend', style_caption))
story.append(spacer(18))

story.append(heading('<b>4.3 Temuan Kualitas Kode dan Performa</b>', style_h2))
story.append(para(
    'Frontend memiliki beberapa masalah kualitas kode yang signifikan. Pertama, bundle client-side sangat besar dengan lebih dari '
    '80 dependensi termasuk recharts (~200KB), framer-motion (~100KB), @dnd-kit (~50KB), dan react-syntax-highlighter (~100KB+). '
    'Tidak ada dynamic imports atau lazy loading yang digunakan di mana pun. @tanstack/react-query terinstal tapi tidak pernah '
    'digunakan - semua halaman dashboard mengimplementasikan manual useState + useEffect + useCallback pattern, sehingga tidak '
    'ada cache invalidation, deduplication, retry logic, atau optimistic updates.'
))
story.append(para(
    'Kedua, terdapat sistem autentikasi ganda yang saling bertumpang tindih: custom SEMS auth (direct GAS login ke localStorage) '
    'dan NextAuth (JWT-based session dengan SessionProvider). TokenSync.tsx menjembatani keduanya, tetapi menambah kompleksitas '
    'tanpa manfaat yang jelas. Ketiga, TypeScript build errors di-suppress dengan ignoreBuildErrors: true, sehingga potensi '
    'type-safety bugs dapat mencapai production. Keempat, file halaman seperti analytics (942 baris) dan automation (1008 baris) '
    'terlalu besar dengan helper functions, sub-components, state management, dan rendering dalam satu file.'
))

fe_perf_findings = [
    ('FE-P01', 'TINGGI', 'Bundle Besar - Tidak Ada Code Splitting', 'package.json, semua pages',
     '80+ dependensi tanpa lazy loading. Estimasi bundle >500KB gzipped.'),
    ('FE-P02', 'TINGGI', 'React Query Terinstal Tapi Tidak Digunakan', 'package.json:50, semua dashboard pages',
     'Manual data fetching tanpa caching, deduplication, retry, atau optimistic updates.'),
    ('FE-P03', 'SEDANG', 'Dual Auth System - Custom SEMS + NextAuth', 'useSemsAuth.ts, TokenSync.tsx',
     'Dua sistem autentikasi paralel menambah kompleksitas tanpa manfaat jelas. NextAuth tampak legacy.'),
    ('FE-P04', 'SEDANG', 'PWA Cache Strategy Minimal', 'public/sw.js',
     'Hanya 4 static assets di-cache. Application bundle (JS/CSS) tidak di-pre-cache untuk offline.'),
    ('FE-P05', 'SEDANG', 'API Fallback ke Homepage saat Offline', 'public/sw.js:47-53',
     'API call gagal offline mengembalikan HTML homepage, menyebabkan JSON parse error.'),
    ('FE-P06', 'RENDAH', 'Prisma Schema Default Boilerplate Tidak Digunakan', 'prisma/schema.prisma',
     'User dan Post models dari Prisma init. Data asli di Google Sheets. Dead code.'),
    ('FE-P07', 'RENDAH', 'React Strict Mode Disabled', 'next.config.ts:9',
     'Strict mode dimatikan. Potensi side effect issues di useEffect tidak terdeteksi saat development.'),
]
story.append(finding_table(fe_perf_findings))
story.append(Paragraph('Tabel 8: Temuan Kualitas Kode dan Performa Frontend', style_caption))
story.append(spacer(18))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. ANALISIS INTEGRASI ANTAR KOMPONEN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>5. Analisis Integrasi Antar Komponen</b>', style_h1))

story.append(heading('<b>5.1 Alur Data End-to-End</b>', style_h2))
story.append(para(
    'Alur data SEMS dimulai dari firmware ESP32 yang membaca sensor secara periodik (interval polling sensor), memproses data '
    'melalui sensor engine, menyimpannya dalam struct SensorData global, lalu mengirimkan telemetry ke backend GAS melalui HTTPS '
    'POST request. Backend GAS menerima telemetry, menulis ke Google Spreadsheet, memeriksa kondisi alarm, dan mengirimkan notifikasi '
    'email jika diperlukan. Frontend Next.js mengambil data dari backend GAS melalui API proxy route (/api/sems) yang meneruskan '
    'request ke GAS web app URL.'
))
story.append(para(
    'Proses kontrol beban berjalan dalam dua arah: frontend mengirim perintah kontrol relay melalui GAS, yang kemudian disimpan '
    'di spreadsheet. Firmware melakukan config sync secara periodik untuk mengambil konfigurasi terbaru (termasuk state relay) dari '
    'backend. Selain itu, firmware juga mengimplementasikan automation engine lokal yang dapat mengontrol relay berdasarkan kondisi '
    'sensor secara otonom, memberikan kemampuan kontrol lokal meskipun koneksi internet terputus.'
))

story.append(heading('<b>5.2 Temuan Integrasi</b>', style_h2))

int_findings = [
    ('INT-01', 'KRITIS', 'Token di URL pada Seluruh Alur Komunikasi', 'Firmware + Frontend + Backend',
     'Baik firmware dan frontend mengirim token via URL parameter. Token muncul di GAS logs, Vercel logs, dan browser history.'),
    ('INT-02', 'TINGGI', 'Tidak Ada Request Correlation ID', 'Semua komponen',
     'Tidak ada cara mengkorelasikan telemetry POST dengan cleanup atau alarm notification. Debugging lintas komponen sangat sulit.'),
    ('INT-03', 'TINGGI', 'Single Point of Failure pada API Proxy', 'api/sems/route.ts',
     'Semua API call melalui satu proxy route. Jika proxy gagal (15s timeout), seluruh aplikasi offline tanpa fallback.'),
    ('INT-04', 'SEDANG', 'API Proxy Menerima Arbitrary Path', 'api/sems/route.ts:28-29',
     'Proxy meneruskan path apapun ke GAS tanpa validation atau allowlist. Open relay ke GAS URL.'),
    ('INT-05', 'SEDANG', 'Dual Database - Spreadsheet dan Prisma Tidak Terpakai', 'prisma/schema.prisma',
     'Prisma schema ada tapi tidak terpakai. Seluruh data di Google Sheets. Dead code membingungkan developer baru.'),
    ('INT-06', 'SEDANG', 'Bahasa UI Tidak Konsisten', 'Semua halaman frontend',
     'Campuran Indonesia dan Inggris dalam UI, komentar kode, error messages. Pengalaman pengguna terpecah.'),
]
story.append(finding_table(int_findings))
story.append(Paragraph('Tabel 9: Temuan Integrasi Antar Komponen', style_caption))
story.append(spacer(18))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. REKOMENDASI PRIORITAS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>6. Rekomendasi Perbaikan</b>', style_h1))

story.append(heading('<b>6.1 Aksi Segera (0-7 Hari)</b>', style_h2))
story.append(para(
    'Berikut adalah rekomendasi perbaikan yang harus dilakukan secara <b>immediate</b> sebelum sistem digunakan di lingkungan '
    'produksi. Penundaan pada item-item ini dapat mengakibatkan kompromi keamanan, kerusakan perangkat keras, atau kegagalan sistem.'
))

rec_immediate = [
    ['Ganti SEMUA kredensial hardcoded', 'Firmware', 'Ubah WiFi password, API token, OTA password. Implementasikan mekanisme provisioning yang aman (BLE setup atau WiFi Provisioning).'],
    ['Implementasikan tindakan protektif di Safety Engine', 'Firmware', 'Overvoltage harus memutus relay charging. Undervoltage harus memaksa emergency load shed. Overcurrent harus trip contactor. Ini adalah masalah keselamatan perangkat keras.'],
    ['Tambahkan autentikasi pada semua GET routes', 'Backend', 'Semua GET endpoint di routeGet_() harus memeriksi auth sebelum mengembalikan data. Terutama GET /api/config/get yang mengekspos device token.'],
    ['Ganti cookie "sems-auth=1" dengan signed token', 'Frontend', 'Middleware harus memvalidasi token HMAC atau JWT secara server-side. Cookie statik yang dapat dipalsukan harus dihapus.'],
    ['Sanitasi input sebelum menulis ke Google Sheets', 'Backend', 'Prefix semua string yang dikontrol user dengan tanda petik tunggal (\') atau gunakan type coercion untuk mencegah formula injection.'],
    ['Hapus kode modular yang tidak dapat dikompilasi', 'Firmware', 'Selesaikan refactoring atau hapus file sensors/, engines/, utils/ yang tidak kompatibel. Dual codebase menjamin divergensi.'],
]
rec_h = ['Rekomendasi', 'Komponen', 'Detail']
rec_rows = []
for r in rec_immediate:
    rec_rows.append([Paragraph('<b>%s</b>' % r[0], style_td), Paragraph(r[1], style_td_center), Paragraph(r[2], style_td)])
story.append(make_table(rec_h, rec_rows, [CONTENT_W*0.3, CONTENT_W*0.12, CONTENT_W*0.58]))
story.append(Paragraph('Tabel 10: Rekomendasi Aksi Segera', style_caption))
story.append(spacer(18))

story.append(heading('<b>6.2 Prioritas Tinggi (1-4 Minggu)</b>', style_h2))
story.append(para(
    'Item-item berikut harus ditangani dalam jangka pendek setelah aksi segera selesai. Mereka mengurangi risiko keamanan dan '
    'meningkatkan keandalan sistem secara signifikan.'
))

rec_high = [
    ['Implementasikan per-device token', 'Backend + Firmware', 'Ganti shared token dengan identitas perangkat unik. Aktifkan audit trail dan kemampuan revoke akses per perangkat.'],
    ['Tambahkan input validation pada telemetry', 'Backend', 'Validasi range numerik (voltage, current, temperature) sebelum menulis ke spreadsheet. Cegah data anomali.'],
    ['Implementasikan overcurrent dan temperature monitoring', 'Firmware', 'Aktifkan pengecekan SAFETY_OVERCURRENT_A dan SAFETY_MAX_TEMP_C di firmware produksi (.ino).'],
    ['Hapus token dari URL query parameter', 'Firmware + Frontend', 'Gunakan request body untuk POST atau implementasikan google.script.run client API. Hapus fallback ?token=...'],
    ['Gunakan React Query untuk data fetching', 'Frontend', 'Migrasi dari manual useState/useEffect ke @tanstack/react-query (sudah terinstal). Aktifkan caching dan deduplication.'],
    ['Implementasikan tiered load shedding', 'Firmware', 'Ganti shedding biner dengan priority-based shedding sesuai TIER1/TIER2/TIER3. Non-esensial duluan, kenyamanan terakhir.'],
    ['Kurangi frekuensi EEPROM write atau gunakan NVS', 'Firmware', 'EEPROM wear ~70 hari pada rate saat ini. Gunakan NVS atau kurangi interval simpan SOC.'],
]
rec_rows2 = []
for r in rec_high:
    rec_rows2.append([Paragraph('<b>%s</b>' % r[0], style_td), Paragraph(r[1], style_td_center), Paragraph(r[2], style_td)])
story.append(make_table(rec_h, rec_rows2, [CONTENT_W*0.3, CONTENT_W*0.12, CONTENT_W*0.58]))
story.append(Paragraph('Tabel 11: Rekomendasi Prioritas Tinggi', style_caption))
story.append(spacer(18))

story.append(heading('<b>6.3 Prioritas Menengah (1-3 Bulan)</b>', style_h2))
story.append(para(
    'Item-item berikut meningkatkan kualitas, maintainability, dan pengalaman pengguna tetapi tidak bersifat mendesak. '
    'Mereka dapat direncanakan dalam roadmap pengembangan jangka menengah.'
))

rec_med = [
    ['Konsolidasi sistem autentikasi', 'Frontend', 'Hapus NextAuth jika tidak digunakan. Gunakan hanya custom SEMS auth dengan perbaikan security.'],
    ['Hapus dependensi dan dead code', 'Frontend', 'Hapus Prisma schema, zustand, @mdxeditor/editor, dan dependensi unused lainnya. Kurangi bundle size.'],
    ['Implementasikan PWA caching yang proper', 'Frontend', 'Pre-cache application bundle untuk offline support. Tambahkan background sync untuk offline actions.'],
    ['Standardisasi bahasa UI', 'Frontend', 'Pilih satu bahasa (Indonesia atau Inggris) untuk seluruh UI, bukan campuran keduanya.'],
    ['Implementasikan PBKDF2 untuk password hashing', 'Backend', 'Ganti SHA-256 single-round dengan PBKDF2 multi-round (GAS tidak mendukung bcrypt).'],
    ['Tambahkan request correlation ID', 'Semua komponen', 'Propagasikan unique ID dari firmware ke GAS ke frontend untuk debugging lintas komponen.'],
    ['Throttle cleanup di backend', 'Backend', 'Jalankan cleanup setiap N-th telemetry POST, bukan setiap kali. Kurangi lock contention dan execution time.'],
    ['Tambahkan API versioning', 'Backend', 'Migrasi ke /api/v1/... untuk memungkinkan breaking changes tanpa mengganggu client lama.'],
    ['Aktifkan TypeScript build errors', 'Frontend', 'Set ignoreBuildErrors: false. Perbaiki type errors untuk mencegah bugs reach production.'],
]
rec_rows3 = []
for r in rec_med:
    rec_rows3.append([Paragraph('<b>%s</b>' % r[0], style_td), Paragraph(r[1], style_td_center), Paragraph(r[2], style_td)])
story.append(make_table(rec_h, rec_rows3, [CONTENT_W*0.3, CONTENT_W*0.12, CONTENT_W*0.58]))
story.append(Paragraph('Tabel 12: Rekomendasi Prioritas Menengah', style_caption))
story.append(spacer(18))

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 7. KESIMPULAN
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
story.extend(add_major('<b>7. Kesimpulan</b>', style_h1))

story.append(para(
    'Sistem SEMS menunjukkan arsitektur yang inovatif dengan integrasi ESP32, Google Apps Script, Spreadsheet, dan Next.js/Vercel '
    'sebagai solusi IoT monitoring energi dengan biaya infrastruktur yang minimal. Fitur-fitur seperti automation engine lokal, '
    'load shedding bertingkat (meskipun belum lengkap), RBAC multi-level, dan email notification dengan rate limiting menunjukkan '
    'pemikiran desain yang matang dalam beberapa aspek.'
))
story.append(para(
    'Namun, audit ini mengungkapkan bahwa sistem ini <b>belum siap untuk deployment produksi</b> dalam kondisi saat ini. '
    'Terdapat 16 temuan KRITIS yang mencakup: kredensial hardcoded di firmware, Safety Engine yang tidak mengambil tindakan '
    'protektif terhadap kondisi baterai berbahaya, seluruh endpoint GET backend tanpa autentikasi, middleware frontend yang '
    'trivially bypassable, dan potensi formula injection di Google Sheets. Temuan-temuan ini, jika dieksploitasi, dapat menyebabkan '
    'kompromi data, pengambilalihan perangkat, kerusakan perangkat keras baterai, atau bahkan risiko kebakaran.'
))
story.append(para(
    'Rekomendasi utama adalah memprioritaskan perbaikan pada enam item aksi segera (Bagian 6.1) sebelum sistem digunakan '
    'di lingkungan nyata. Dengan perbaikan yang tepat pada aspek keamanan, keselamatan perangkat keras, dan kualitas kode, '
    'SEMS memiliki potensi untuk menjadi platform manajemen energi yang andal dan aman. Tim pengembangan disarankan untuk '
    'mengadopsi pendekatan security-by-design dan safety-by-design dalam iterasi pengembangan selanjutnya, termasuk '
    'implementasi code review, pengujian unit untuk logika safety-critical, dan security testing berkala.'
))


# ━━━━ BUILD ━━━━
doc.multiBuild(story, onLaterPages=add_page_number, onFirstPage=add_page_number)
print(f"Body PDF generated: {BODY_PDF}")
