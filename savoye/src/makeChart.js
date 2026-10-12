import { Chart, LineController, LineElement, CategoryScale, LinearScale, PointElement, Tooltip } from "chart.js";
import { store } from "./store.js";

Chart.register(
    LineElement,
    LineController,
    CategoryScale,  // X축 스케일
    LinearScale,    // Y축 스케일
    PointElement,   // 데이터 포인트
    Tooltip,
);

const PALETTE = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#64748b"];

// 현재 타임라인 위치를 세로 점선으로 표시
const cursorPlugin = {
    id: "ablCursor",
    afterDatasetsDraw(chart) {
        const x = chart.scales.x;
        if (!x || !chart.data.labels?.length) return;
        const px = x.getPixelForValue(store.mainIndex);
        const { top, bottom } = chart.chartArea;
        const ctx = chart.ctx;
        ctx.save();
        ctx.strokeStyle = "rgba(37, 99, 235, 0.6)";
        ctx.lineWidth = 1.25;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(px, top);
        ctx.lineTo(px, bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#2563eb";
        ctx.beginPath();
        ctx.arc(px, top, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },
};

export function MakeChart(timeKeys, quant, canvasId) {
    const labels = timeKeys;
    const quantNames = [];
    const quantData = [];

    (quant || []).forEach(arr => {
        quantNames.push(arr[0]);
        quantData.push(arr.slice(1));
    });

    let myCanvas = document.getElementById(canvasId);
    const __existing = Chart.getChart(myCanvas);   // destroy a previous chart so the canvas can be reused (re-init)
    if (__existing) __existing.destroy();

    // 데이터가 없으면 카드에 빈 상태 표시
    myCanvas?.closest(".chart-card")?.classList.toggle("is-empty", quantNames.length === 0);

    const datasets = quantNames.map((name, index) => ({
        label: name,
        data: quantData[index],
        borderColor: PALETTE[index % PALETTE.length],
        backgroundColor: PALETTE[index % PALETTE.length] + "33",
        borderWidth: 1.75,
        fill: false,
        tension: 0.3,
        pointRadius: 0,
        pointHoverRadius: 3,
    }));

    const totalDuration = 1000;
    const delayBetweenPoints = totalDuration / Math.max(1, timeKeys.length);

    const previousY = (ctx) => {
        if (!ctx.chart) return 0;
        const datasetMeta = ctx.chart.getDatasetMeta(ctx.datasetIndex);
        if (ctx.index - 1 < 0 || ctx.index - 1 >= datasetMeta.data.length) return 0;
        const prevDataPoint = datasetMeta.data[ctx.index - 1];
        if (!prevDataPoint || typeof prevDataPoint.getProps !== "function") return 0;
        return prevDataPoint.getProps(['y'], true).y;
    };

    const animation = {
        x: {
            type: 'number',
            easing: 'linear',
            duration: delayBetweenPoints,
            from: NaN, // the point is initially skipped
            delay(ctx) {
                if (ctx.type !== 'data' || ctx.xStarted) return 0;
                ctx.xStarted = true;
                return ctx.index * delayBetweenPoints;
            }
        },
        y: {
            type: 'number',
            easing: 'linear',
            duration: delayBetweenPoints,
            from: previousY,
            delay(ctx) {
                if (ctx.type !== 'data' || ctx.yStarted) return 0;
                ctx.yStarted = true;
                return ctx.index * delayBetweenPoints;
            }
        }
    };

    const chart1 = new Chart(myCanvas, {
        type: "line",
        data: { labels, datasets },
        plugins: [cursorPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: "#111827",
                    padding: 10,
                    cornerRadius: 8,
                    titleFont: { size: 11, weight: "600" },
                    bodyFont: { size: 12 },
                    boxPadding: 4,
                    callbacks: {
                        title: (items) => {
                            const p = String(items[0]?.label || "").split("_");
                            return p.length >= 6 ? `${p[0]}.${p[1]}.${p[2]} ${p[3]}:${p[4]}:${p[5]}` : items[0]?.label;
                        },
                    },
                },
            },
            scales: {
                x: { grid: { display: false }, border: { display: false }, ticks: { display: false } },
                y: {
                    beginAtZero: true,
                    grid: { color: "#eef1f5" },
                    border: { display: false },
                    ticks: { display: true, color: "#9aa5b4", font: { size: 10 }, maxTicksLimit: 4 },
                },
            },
            animation,
        }
    });

    return { chart1, myCanvas };
}
