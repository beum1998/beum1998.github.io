// 뷰어 전역 벡터 아이콘 (24×24, 선 두께 2). 폰트/인터넷 없이 동작하도록 SVG 문자열로 둔다.

const PATHS = {
    pin: '<path d="M12 21s-6.5-5.8-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/>',
    pinSolid: '<path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z" fill="currentColor" stroke="none"/><circle cx="12" cy="10" r="2.6" fill="#fff" stroke="none"/>',
    split: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M12 4.5v15"/>',
    compare: '<circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="18" r="2.4"/><path d="M6 8.4V14a4 4 0 0 0 4 4h5.6"/><path d="M18 15.6V10a4 4 0 0 0-4-4H8.4"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    play: '<path d="M8 5.6v12.8a.7.7 0 0 0 1.06.6l10.2-6.4a.7.7 0 0 0 0-1.2L9.06 5A.7.7 0 0 0 8 5.6z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="6.5" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.7" y="5" width="3.8" height="14" rx="1.2" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.2" fill="currentColor" stroke="none"/>',
    stepBack: '<path d="M15 6l-6 6 6 6"/>',
    stepFwd: '<path d="M9 6l6 6-6 6"/>',
    rewind: '<path d="M11.5 17.5 4 12l7.5-5.5zM20 17.5 12.5 12 20 6.5z" fill="currentColor" stroke="none"/>',
    ff: '<path d="M12.5 6.5 20 12l-7.5 5.5zM4 6.5 11.5 12 4 17.5z" fill="currentColor" stroke="none"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    calendar: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/>',
    layers: '<path d="m12 3.5 8.5 4.8L12 13 3.5 8.3z"/><path d="m3.5 12.2 8.5 4.8 8.5-4.8"/><path d="m3.5 16 8.5 4.5 8.5-4.5"/>',
    box: '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    chart: '<path d="M4 4v16h16"/><path d="m8 15 3.5-4.5 3 2.5L19 7"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
    quant: '<rect x="4" y="12" width="4" height="8" rx="1"/><rect x="10" y="7" width="4" height="13" rx="1"/><rect x="16" y="4" width="4" height="16" rx="1"/>',
    mic: '<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    chevronRight: '<path d="m9 6 6 6-6 6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    swap: '<path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.2M12 17.2v.1"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3A4 4 0 0 0 13 5.34l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3A4 4 0 0 0 11 18.66l1-1"/>',
    focus: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/><circle cx="12" cy="12" r="2.8"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1"/>',
    edit: '<path d="M4 20h4.2L19 9.2 14.8 5 4 15.8z"/><path d="m13.5 6.3 4.2 4.2"/>',
    waveform: '<path d="M4 10v4M8 6v12M12 9v6M16 4v16M20 10v4"/>',
    empty: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M4 14h4l1.5 2h5l1.5-2h4"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-13.7-5.2L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 13.7 5.2L20 16"/><path d="M20 20v-4h-4"/>',
    sparkle: '<path d="M12 3.5 13.7 9l5.3 1.7-5.3 1.7L12 18l-1.7-5.6L5 10.7 10.3 9z"/><path d="M18.5 3v3M20 4.5h-3M6 17v2.5M7.25 18.25h-2.5"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    download: '<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
    upload: '<path d="M12 20V9"/><path d="m7.5 13 4.5-4.5 4.5 4.5"/><path d="M4.5 4.5h15"/>',
    more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
    doc: '<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/><path d="M9 13h6M9 16.5h6"/>',
    trash: '<path d="M5 7h14"/><path d="M9.5 7V5h5v2"/><path d="M7 7l.8 12h8.4L17 7"/>',
    eye: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.6A10 10 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9M6.6 6.7A17 17 0 0 0 2 12s3.6 6.5 10 6.5c1.4 0 2.6-.3 3.7-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
    camera: '<path d="M4 8.5h3.2l1.6-2.5h6.4l1.6 2.5H20a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5z"/><circle cx="12" cy="13.5" r="3.2"/>',
};

export function icon(name, size = 16, cls = "") {
    return `<svg class="ico ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" `
        + `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`
        + `${PATHS[name] || ""}</svg>`;
}

// 핀 찍기 전용 픽셀 아이콘(32×32 원본을 색별 경로로 옮김) — 손가락이 핀을 꾹 누르는 모습.
// 어떤 크기에서도 칸이 번지지 않게 crispEdges, 색은 원본 그대로(글자색을 따르지 않음).
const PIN_STAMP = '<path fill="#e2ff53" d="M9 1h13v1H9zM8 2h15v1H8zM8 3h16v1H8zM7 4h4v1H7zM17 4h7v1H17zM7 5h4v1H7zM18 5h7v1H18zM6 6h5v1H6zM18 6h7v1H18zM5 7h6v1H5zM18 7h7v1H18zM5 8h6v1H5zM18 8h8v1H18zM5 9h6v1H5zM17 9h9v1H17zM5 10h7v1H5zM16 10h10v1H16zM5 11h21v1H5zM5 12h21v1H5zM5 13h21v1H5zM5 14h10v1H5zM23 14h3v1H23zM5 15h9v1H5zM23 15h2v1H23zM5 16h9v1H5zM24 16h1v1H24zM5 17h9v1H5zM5 18h8v1H5zM6 19h7v1H6zM6 20h7v1H6zM6 21h8v1H6zM7 22h7v1H7zM7 23h8v1H7zM8 24h7v1H8zM9 25h6v1H9zM9 26h7v1H9zM10 27h6v1H10zM11 28h6v1H11zM13 29h3v1H13zM14 30h1v1H14z"/><path fill="#e3e7f8" d="M12 5h4v1H12zM12 6h5v1H12zM12 7h5v1H12zM12 8h4v1H12zM13 9h2v1H13zM17 15h3v1H17zM18 16h1v1H18zM14 18h2v1H14zM14 19h2v1H14zM15 20h1v1H15z"/><path fill="#e898dc" d="M21 15h1v1H21zM15 16h1v1H15zM21 16h1v1H21zM20 17h3v1H20zM17 18h7v1H17zM17 19h9v1H17zM17 20h11v1H17zM17 21h15v1H17zM15 22h17v1H15zM16 23h16v1H16zM16 24h16v1H16zM17 25h15v1H17zM17 26h15v1H17zM18 27h14v1H18zM18 28h14v1H18zM19 29h13v1H19zM20 30h12v1H20zM21 31h11v1H21z"/><path fill="#000000" d="M8 0h15v1H8zM8 1h1v1H8zM22 1h2v1H22zM7 2h1v1H7zM23 2h2v1H23zM6 3h2v1H6zM24 3h1v1H24zM6 4h1v1H6zM11 4h6v1H11zM24 4h2v1H24zM5 5h2v1H5zM11 5h1v1H11zM16 5h2v1H16zM25 5h1v1H25zM5 6h1v1H5zM11 6h1v1H11zM17 6h1v1H17zM25 6h1v1H25zM4 7h1v1H4zM11 7h1v1H11zM17 7h1v1H17zM25 7h2v1H25zM4 8h1v1H4zM11 8h1v1H11zM16 8h2v1H16zM26 8h1v1H26zM4 9h1v1H4zM11 9h2v1H11zM15 9h2v1H15zM26 9h1v1H26zM4 10h1v1H4zM12 10h4v1H12zM26 10h1v1H26zM4 11h1v1H4zM26 11h1v1H26zM4 12h1v1H4zM26 12h1v1H26zM4 13h1v1H4zM26 13h1v1H26zM4 14h1v1H4zM15 14h8v1H15zM26 14h1v1H26zM4 15h1v1H4zM14 15h3v1H14zM20 15h1v1H20zM22 15h1v1H22zM25 15h2v1H25zM4 16h1v1H4zM14 16h1v1H14zM16 16h2v1H16zM19 16h2v1H19zM22 16h2v1H22zM25 16h1v1H25zM4 17h1v1H4zM14 17h6v1H14zM23 17h3v1H23zM4 18h1v1H4zM13 18h1v1H13zM16 18h1v1H16zM24 18h3v1H24zM5 19h1v1H5zM13 19h1v1H13zM16 19h1v1H16zM26 19h2v1H26zM5 20h1v1H5zM13 20h2v1H13zM16 20h1v1H16zM28 20h4v1H28zM5 21h1v1H5zM14 21h3v1H14zM6 22h1v1H6zM14 22h1v1H14zM6 23h1v1H6zM15 23h1v1H15zM7 24h1v1H7zM15 24h1v1H15zM7 25h2v1H7zM15 25h2v1H15zM8 26h1v1H8zM16 26h1v1H16zM9 27h1v1H9zM16 27h2v1H16zM10 28h1v1H10zM17 28h1v1H17zM11 29h2v1H11zM16 29h3v1H16zM12 30h2v1H12zM15 30h2v1H15zM19 30h1v1H19zM13 31h3v1H13zM19 31h2v1H19z"/>';

export function pinStamp(size = 16, cls = "") {
    return `<svg class="ico ico--stamp ${cls}" width="${size}" height="${size}" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">${PIN_STAMP}</svg>`;
}
