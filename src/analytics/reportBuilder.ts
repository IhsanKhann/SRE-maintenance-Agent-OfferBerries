import { AnalyticsDaily } from "../db/models/AnalyticsDaily.js";
import { Incident } from "../db/models/Incident.js";
import { ActionHistory } from "../db/models/ActionHistory.js";
import { TelemetrySnapshot } from "../db/models/TelemetrySnapshot.js";
import { sendWhatsApp } from "../comms/whatsapp.js";
import { logger } from "../utils/logger.js";

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" });
}

export async function buildAndSendWeeklyReport(): Promise<void> {
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  try {
    // Aggregate last 7 days of analytics
    const days = await AnalyticsDaily.find({
      date: { $gte: weekStart, $lte: now },
    }).sort({ date: 1 });

    // Calculate totals
    const totalRequests = days.reduce((s, d) => s + d.traffic.totalRequests, 0);
    const totalErrors = days.reduce((s, d) => s + d.traffic.errorCount, 0);
    const avgErrorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
    const avgP95 = days.length > 0 ? days.reduce((s, d) => s + d.traffic.p95LatencyMs, 0) / days.length : 0;
    const peakP99 = Math.max(...days.map((d) => d.traffic.p99LatencyMs), 0);

    const totalHrEvents = days.reduce((s, d) => s + d.business.hrEvents, 0);
    const totalFinEvents = days.reduce((s, d) => s + d.business.financialEvents, 0);
    const totalOutboxDelivered = days.reduce((s, d) => s + d.business.outboxDelivered, 0);
    const totalOutboxFailed = days.reduce((s, d) => s + d.business.outboxFailed, 0);
    const totalSyncReceived = days.reduce((s, d) => s + d.business.syncReceived, 0);
    const totalSyncFailed = days.reduce((s, d) => s + d.business.syncFailed, 0);

    const totalAutoRecoveries = days.reduce((s, d) => s + d.infrastructure.autoRecoveries, 0);
    const totalActions = days.reduce((s, d) => s + d.infrastructure.actionsExecuted, 0);
    const totalBackupsOk = days.reduce((s, d) => s + d.infrastructure.backupsOk, 0);
    const totalBackupsFailed = days.reduce((s, d) => s + d.infrastructure.backupsFailed, 0);
    const totalCost = days.reduce((s, d) => s + d.cost.totalUsd, 0);
    const totalGroqTokens = days.reduce((s, d) => s + d.infrastructure.groqTokens, 0);
    const totalClaudeTokens = days.reduce((s, d) => s + d.infrastructure.claudeTokens, 0);

    const downtimeMinutes = days.reduce((s, d) => s + d.uptime.downtimeMinutes, 0);
    const avgUptime = days.length > 0 ? days.reduce((s, d) => s + d.uptime.uptimePercent, 0) / days.length : 100;
    const incidents = days.reduce((s, d) => s + d.uptime.incidents, 0);
    const avgMttr = incidents > 0 ? days.reduce((s, d) => s + d.uptime.mttrMinutes * d.uptime.incidents, 0) / incidents : 0;

    // Get recent incidents for context
    const recentIncidents = await Incident.find({
      openedAt: { $gte: weekStart },
    }).sort({ openedAt: -1 }).limit(5);

    const incidentSummary = recentIncidents.length > 0
      ? recentIncidents
          .map((i) => `  • ${i.severity.toUpperCase()}: ${i.trigger.signal} (${i.resolvedBy ?? "open"})`)
          .join("\n")
      : "  • None";

    const uptimeEmoji = avgUptime >= 99.9 ? "🟢" : avgUptime >= 99 ? "🟡" : "🔴";

    const report = [
      `📊 Weekly Report — OfferBerries ERP`,
      `${formatDate(weekStart)} – ${formatDate(now)}`,
      ``,
      `${uptimeEmoji} Uptime: ${avgUptime.toFixed(2)}%`,
      downtimeMinutes > 0 ? `⏱️ Downtime: ${downtimeMinutes.toFixed(1)} min (${incidents} incident${incidents !== 1 ? "s" : ""})` : `✅ Zero downtime this week`,
      avgMttr > 0 ? `⚡ Mean recovery: ${avgMttr.toFixed(1)} min` : "",
      ``,
      `📈 Traffic`,
      `• Total requests: ${totalRequests.toLocaleString()}`,
      `• Avg error rate: ${avgErrorRate.toFixed(2)}%`,
      `• Avg p95 latency: ${avgP95.toFixed(0)}ms | Peak p99: ${peakP99.toFixed(0)}ms`,
      ``,
      `💰 Business Events`,
      `• Financial events: ${totalFinEvents.toLocaleString()}`,
      `• HR events: ${totalHrEvents.toLocaleString()}`,
      `• Outbox delivered: ${totalOutboxDelivered.toLocaleString()} (${totalOutboxFailed} failed)`,
      ``,
      `🔗 Backend-B Sync`,
      `• Events received: ${totalSyncReceived.toLocaleString()}`,
      totalSyncFailed > 0 ? `• ⚠️ Failures: ${totalSyncFailed}` : `• Failures: 0`,
      ``,
      `⚙️ Operations`,
      `• Auto-recoveries: ${totalAutoRecoveries}`,
      `• Agent actions: ${totalActions}`,
      `• Backups: ${totalBackupsOk}/7 successful${totalBackupsFailed > 0 ? ` (${totalBackupsFailed} failed)` : ""}`,
      ``,
      `📋 Incidents:`,
      incidentSummary,
      ``,
      `💵 AI Cost This Week: $${totalCost.toFixed(2)} USD`,
      `  Groq: ${(totalGroqTokens / 1000).toFixed(0)}k tokens`,
      `  Claude: ${(totalClaudeTokens / 1000).toFixed(0)}k tokens`,
      ``,
      `Send STATUS for live state.`,
    ].filter(Boolean).join("\n");

    await sendWhatsApp(report);
    logger.info("[Analytics] Weekly report sent");
  } catch (err: any) {
    logger.error("[Analytics] Failed to build weekly report", { error: err.message });
  }
}

export async function aggregateDailyStats(date: Date): Promise<void> {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  try {
    const [snapshots, incidents, actions] = await Promise.all([
      TelemetrySnapshot.find({ capturedAt: { $gte: dayStart, $lt: dayEnd } }).lean(),
      Incident.find({ openedAt: { $gte: dayStart, $lt: dayEnd } }).lean(),
      ActionHistory.find({ executedAt: { $gte: dayStart, $lt: dayEnd } }).lean(),
    ]);

    if (snapshots.length === 0) return;

    const avgErrorRate = snapshots.reduce((s, snap) => s + snap.prometheus.httpErrorRate, 0) / snapshots.length;
    const totalRequests = Math.max(...snapshots.map((s) => s.prometheus.httpRequestsTotal), 0);
    const avgP95 = snapshots.reduce((s, snap) => s + snap.prometheus.p95LatencyMs, 0) / snapshots.length;
    const avgP99 = snapshots.reduce((s, snap) => s + snap.prometheus.p99LatencyMs, 0) / snapshots.length;

    const downtimeSnapshots = snapshots.filter((s) => !s.backendBSync.syncEndpointUp).length;
    const downtimeMinutes = (downtimeSnapshots / snapshots.length) * 60 * 24;
    const uptimePercent = 100 - (downtimeSnapshots / snapshots.length) * 100;

    const resolvedIncidents = incidents.filter((i) => i.mttrSeconds != null);
    const avgMttrMinutes = resolvedIncidents.length > 0
      ? resolvedIncidents.reduce((s, i) => s + (i.mttrSeconds ?? 0), 0) / resolvedIncidents.length / 60
      : 0;

    await AnalyticsDaily.findOneAndUpdate(
      { date: dayStart },
      {
        uptime: {
          totalMinutes: 1440,
          downtimeMinutes,
          uptimePercent,
          incidents: incidents.length,
          mttrMinutes: avgMttrMinutes,
        },
        traffic: {
          totalRequests,
          errorCount: Math.round(totalRequests * avgErrorRate),
          errorRate: avgErrorRate * 100,
          p50LatencyMs: avgP95 * 0.6, // approximation
          p95LatencyMs: avgP95,
          p99LatencyMs: avgP99,
        },
        business: {
          hrEvents: Math.max(...snapshots.map((s) => s.prometheus.hrEventsTotal), 0),
          financialEvents: Math.max(...snapshots.map((s) => s.prometheus.financialEventsTotal), 0),
          outboxDelivered: 0,
          outboxFailed: Math.max(...snapshots.map((s) => s.backendBSync.outboxFailedCount), 0),
          syncReceived: 0,
          syncFailed: snapshots.filter((s) => s.backendBSync.recentSyncFailures > 0).length,
        },
        infrastructure: {
          autoRecoveries: actions.filter((a) => a.authorizedBy === "autonomous" && a.success).length,
          actionsExecuted: actions.length,
          groqTokens: 0,
          claudeTokens: 0,
          backupsOk: actions.filter((a) => a.toolName === "dailyMongoBackup" && a.success).length,
          backupsFailed: actions.filter((a) => a.toolName === "dailyMongoBackup" && !a.success).length,
          avgDiskPercent: snapshots.reduce((s, snap) => s + snap.system.diskUsagePercent, 0) / snapshots.length,
          peakMemPercent: Math.max(...snapshots.flatMap((s) =>
            s.docker.containers.map((c) => c.memLimitMb > 0 ? (c.memUsageMb / c.memLimitMb) * 100 : 0)
          ), 0),
        },
        cost: { groqUsd: 0, claudeUsd: 0, totalUsd: 0 },
      },
      { upsert: true, new: true }
    );

    logger.info("[Analytics] Daily stats aggregated", { date: dayStart.toISOString().split("T")[0] });
  } catch (err: any) {
    logger.error("[Analytics] Failed to aggregate daily stats", { error: err.message });
  }
}
