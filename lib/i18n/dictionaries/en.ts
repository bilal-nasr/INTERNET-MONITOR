/**
 * Every word the application shows, in English.
 *
 * This object is the source of truth for the shape of a dictionary: `Dictionary`
 * is derived from it, and every other language is checked against that type, so
 * a missing or misspelled key is a build error rather than a blank label.
 *
 * Conventions:
 *  - `{name}` marks a value filled in at render time by `fill()`.
 *  - A value that changes with a count is wrapped in `plural()`, which admits
 *    every CLDR category. English fills `one` and `other`; Arabic fills all six.
 *  - Units that come from the database (GB, MB, TB, B) are never translated.
 */

/** The CLDR plural categories. Only `other` is required; a language fills what it needs. */
export interface PluralForms {
  zero?: string;
  one?: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
}

/**
 * Identity, but it pins the property's type to `PluralForms` so a language that
 * distinguishes more categories than English can add them.
 */
function plural(forms: PluralForms): PluralForms {
  return forms;
}

export const en = {
  meta: {
    appName: "MikroTik Quota Monitor",
    appDescription: "Daily internet usage tracking for a MikroTik WAN interface",
  },

  language: {
    label: "Language",
    switchTo: "Switch to {language}",
  },

  nav: {
    dashboard: "Dashboard",
    statistics: "Statistics",
    sessions: "Sessions",
    settings: "Settings",
    export: "Export",
  },

  footer: {
    ingest: "Readings are pushed by the router's quota-push script to {path}.",
  },

  common: {
    empty: "-",
    never: "never",
    notYet: "not yet",
    justNow: "just now",
    yes: "yes",
    no: "no",
    clear: "Clear",
    apply: "Apply",
    dismiss: "Dismiss",
    from: "From",
    to: "To",
    total: "Total",
    used: "Used",
    status: "Status",
    download: "Download",
    upload: "Upload",
    readings: "Readings",
    sessions: "Sessions",
    alert: "Alert",
    sent: "sent",
    minutesAgo: "{minutes} min ago",
    secondsAgo: "{seconds}s ago",
    noTrafficYet: "no traffic yet",
    noGapsRecorded: "no gaps recorded",
    offlineFor: "{duration} offline",
    onlineFor: "{duration} online",
    readingsCount: "{count} readings",
    live: "Live",
    refreshHint: "Refreshes every {seconds} seconds. Click to refresh now.",
    lastNDays: plural({
      one: "Last {count} day",
      other: "Last {count} days",
    }),
  },

  /** Suffixes for "2d 3h 14m". Short by design: they sit inside dense tables. */
  duration: {
    days: "d",
    hours: "h",
    minutes: "m",
    seconds: "s",
  },

  weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],

  monthsShort: [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ],

  buckets: {
    weekOf: "Week of {date}",
    dateAtTime: "{date}, {time}",
    minute: "minute",
    hour: "hour",
    day: "day",
    week: "week",
    month: "month",
  },

  ranges: {
    last_hour: "Last hour",
    last_6h: "Last 6 hours",
    last_24h: "Last 24 hours",
    today: "Today",
    yesterday: "Yesterday",
    this_week: "This week",
    last_7d: "Last 7 days",
    this_cycle: "This billing cycle",
    last_cycle: "Last billing cycle",
    last_30d: "Last 30 days",
    last_90d: "Last 90 days",
    this_year: "This year",
    all_time: "All time",
    custom: "Custom range",
  },

  rangePicker: {
    custom: "Custom",
    bothDaysIncluded: "Both days are included in full.",
    fallback: "Showing the default range instead: {reason}",
  },

  dashboard: {
    title: "Dashboard",
    quotaWindowHeading: "Today in the quota window",
    windowActive: "(active now)",
    windowInactive: "(now {time})",
    ofQuota: "of {quota} quota ({percent}%)",
    progressLabel: "Usage as a percentage of the daily quota",
    baselineSet: "Baseline set",
    readingsToday: "Readings today",
    quota: "Quota",
    alertSent: "Alert sent",
    waitingForWindow: "Waiting for window",
    overQuota: "Over quota",
    overQuotaAlerted: "Over quota, alerted",
    approachingQuota: "Approaching quota",
    withinQuota: "Within quota",
    historyHeading: "Daily usage in GB, last {days} days",
    historyHint: "all traffic; dashed line = {quota} GB window quota",
    historyEmpty: "No usage recorded yet. Data appears after a few polls.",
  },

  router: {
    heading: "Router",
    link: "Link",
    upFor: "Up for {duration}",
    sinceTime: "{bytes} since {time}",
    downSince: "Down since {time}",
    downExplanation:
      "Offline for {duration}. The router reported the drop and will report again when the link returns.",
    noContact: "No contact with the router",
    noContactExplanation:
      "Nothing heard for {duration}. The router is off, unreachable, or its script has stopped. The last session is shown as it was left.",
    noSessionYet: "No session recorded yet",
    interface: "interface {name}",
    lastReading: "Last reading",
    txRx: "tx {tx} / rx {rx}",
    waitingFirstReading: "Waiting for the first reading.",
    monitoring: "Monitoring",
    monitoringEnabled: "enabled",
    monitoringPaused: "paused, incoming readings are discarded",
  },

  setupError: {
    title: "Database not ready",
    body: "The dashboard could not read the {table} table. Check {variable} and run {file} against the database (see README).",
  },

  cycle: {
    heading: "This billing cycle",
    span: "{start} to {end}",
    ofCap: "of cap",
    ofCapGb: "of {cap} GB cap",
    overCap: "Over the monthly cap",
    onCourseToExceed: "On course to exceed the cap",
    approachingCap: "Approaching the cap",
    onTrack: "On track",
    projected: "Projected",
    projectedHint: "{percent}% of cap",
    dailyAverage: "Daily average",
    dailyAverageHint: "over {days} days",
    dailyBudgetLeft: "Daily budget left",
    dailyBudgetHint: "for {days} days",
    remaining: "Remaining",
    capExceeded: "cap exceeded",
    beforeTheCap: "before the cap",
  },

  stats: {
    title: "Statistics",
    subtitle: "{range} in {timezone}",
    everythingRecorded: "everything recorded",
    rangeSpan: "{start} to {end}",
    trafficOverTime: "Traffic over time, by {bucket}",
    downloadAndUpload: "Download and upload",
    shareOfTotal: "share of total traffic",
    totalTraffic: "total traffic",
    consumptionPerCycle: "Consumption per billing cycle",
    cycleStartsOnDay: "cycle starts on day {day}",
    whenTrafficHappens: "When the traffic happens",
    trafficByWeekdayAndHour: "Traffic by weekday and hour",
    localTime: "local time",
    trafficByHour: "Traffic by hour of day",
    trafficByWeekday: "Traffic by day of week",
    linkReliability: "Link reliability",
    timeOnline: "Time online",
    timeOnlineHint: "uptime against recorded outages",
    sessionLengths: "How long sessions last",
    heaviestSessions: "Heaviest sessions",
    topTenByTraffic: "top 10 by traffic",
    dailyCompliance: "Daily quota compliance",
    dailyUsageInWindow: "Daily usage inside the quota window",
    dailyUsageInWindowHint: "{start}-{end}, quota {quota} GB",
    methodology:
      "Traffic is measured from the growth of the interface counters between readings, so a router reboot never registers as a negative or a giant transfer. Session figures count any session overlapping the range in full, because per-session counters cannot be split at an arbitrary moment.",
    tiles: {
      totalUsed: "Total used",
      downloaded: "Downloaded",
      uploaded: "Uploaded",
      cycleToDate: "Cycle to date",
      cycleToDateHint: "{percent}% of the {cap} GB cap",
      shareOfTotal: "{percent}% of total",
      busiestHour: "Busiest hour of day",
      busiestDay: "Busiest day of week",
      busiestSlot: "Busiest single slot",
      peakThroughput: "Peak throughput",
      peakThroughputHint: "fastest interval between two readings",
      averageThroughput: "Average throughput",
      averageThroughputHint: "over {duration} of samples",
      readingsStored: "Readings stored",
      lastReadingAt: "last at {time}",
      noneYet: "none yet",
      availability: "Availability",
      drops: "Drops",
      meanTimeBetweenDrops: "Mean time between drops",
      sessionsInRange: plural({
        one: "{count} session in range",
        other: "{count} sessions in range",
      }),
      longestSession: "Longest session",
      shortestSession: "shortest {duration}",
      onlyOneSession: "only one session",
      daysWithinQuota: "Days within quota",
      daysWithinQuotaValue: "{within} of {measured}",
      complianceRate: "{percent}% compliance",
      daysOverQuota: "Days over quota",
      alertsSent: plural({
        one: "{count} alert sent",
        other: "{count} alerts sent",
      }),
      averageDay: "Average day in window",
      quotaIs: "quota is {quota}",
      heaviestDay: "Heaviest day",
      noDaysMeasured: "no days measured",
    },
  },

  charts: {
    withinQuota: "Within quota",
    overQuota: "Over quota",
    withinCap: "Within cap",
    overCap: "Over cap",
    quota: "quota",
    capLabel: "{cap} GB cap",
    inWindow: "In window",
    linkUp: "Link up",
    offline: "Offline",
    availability: "availability",
    quieter: "Quieter",
    busier: "Busier",
    busiestHourValue: "Busiest hour: {bytes}",
    noReadings: "no readings",
    heatCell: "{weekday} {time} — {value}",
    complianceEmpty: "No days in this range have readings inside the quota window.",
    cycleHistoryEmpty: "No completed billing cycles have readings yet.",
    cycleInProgress: "still in progress",
    cycleHistoryNote:
      "The rightmost cycle is still in progress, so its bar is lighter and will keep growing.",
    capOffScale: "The {cap} GB cap is off this scale: the heaviest cycle reached {peak} GB.",
    nothingRecorded: "Nothing recorded in this range.",
    noTraffic: "No traffic recorded in this range.",
    noSessions: "No sessions recorded in this range.",
  },

  durationBuckets: ["< 5m", "5m - 30m", "30m - 2h", "2h - 6h", "6h - 24h", "> 24h"],

  sessions: {
    title: "Link sessions",
    subtitle:
      "Every WAN connection the router reported, with its uptime and traffic. Times in {timezone}.",
    footnote:
      "Totals are the sum of each session's own counters, so a reconnect never loses or double-counts traffic. Traffic between the last sample and an unexpected drop cannot be recovered, so a session can under-report by up to one polling interval. At most {limit} sessions are listed; narrow the range to see older ones.",
    empty: "No sessions in this range. They appear once the router script posts its first reading.",
    totalConsumed: "Total consumed",
    sessionsCount: plural({
      one: "{count} session",
      other: "{count} sessions",
    }),
    receivedOnWan: "received on the WAN link",
    sentOnWan: "sent on the WAN link",
    linkUp: "Link up",
    selectAll: plural({
      one: "Select all {count} session",
      other: "Select all {count} sessions",
    }),
    selectEveryShown: "Select every session shown",
    includeInTotal: "Include the session opened at {time} in the total",
    selectHint: "Select rows to total their usage. Clicking anywhere on a row selects it.",
    selectedCount: plural({
      one: "{count} session selected",
      other: "{count} sessions selected",
    }),
    totalling: "Totalling...",
    totalsFailed: "Could not total the selection: {reason}",
    timeOnline: "Time online",
    opened: "Opened",
    closed: "Closed",
    uptime: "Uptime",
    offlineBefore: "Offline before",
    live: "Live",
    noContact: "No contact",
    nothingHeardFor: "Nothing heard for {duration}",
    dropped: "Dropped",
    closedStatus: "Closed",
    topFootnote:
      "Each figure is the session's own whole-session total, so a session straddling the edge of the range is counted in full.",
    allSessions: "All sessions",
    upShort: "Up {duration}",
    downBytes: "Down {bytes}",
    upBytes: "Up {bytes}",
  },

  settings: {
    title: "Settings",
    subtitle: "Changes take effect on the next poll. No redeploy needed.",
    loading: "Loading settings...",
    loadFailed: "Could not load settings",
    saved: "Settings saved.",
    saveFailed: "Save failed: {reason}",
    save: "Save settings",
    saving: "Saving...",
    testSent: "Test email sent to {address}.",
    testFailed: "Test email failed: {reason}",
    sendTest: "Send test email",
    sending: "Sending...",
    httpError: "HTTP {status}",
    quotaSection: "Quota",
    quotaSectionHint:
      "Usage inside this daily window counts against the quota. Times are in the timezone below.",
    quotaGb: "Quota (GB)",
    quotaGbHint: "1 GB = 1,000,000,000 bytes",
    windowStart: "Window start",
    windowEnd: "Window end",
    timezone: "Timezone",
    timezonePlaceholder: "e.g. Asia/Beirut",
    timezoneHint: "IANA name. Determines which day a reading belongs to and when the window opens.",
    monthlySection: "Monthly cap",
    monthlySectionHint:
      "The total allowed across one billing cycle, counting all traffic at every hour, not just the daily window above.",
    monthlyQuotaGb: "Maximum consumption (GB)",
    monthlyQuotaGbHint: "Shown as a ring on the dashboard, with a projection for the cycle.",
    billingCycleDay: "Cycle starts on day",
    billingCycleDayHint:
      "Day of the month the cap resets. A day past the end of a short month falls back to that month's last day.",
    alertsSection: "Alerts",
    alertEmail: "Alert email",
    alertEmailHint: "The test goes to the saved address. Save first if you just changed it.",
    alertLanguage: "Alert language",
    alertLanguageHint: "Applies to the emails sent when the daily quota is exceeded.",
    routerSection: "Router",
    routerSectionHint:
      "The router pushes its counters to /api/ingest; the app never connects to the router. Set the interface name so readings are labelled correctly.",
    wanInterfaceName: "WAN interface name",
    wanInterfaceNameHint: "Must match the {field} value in the router's quota-push script.",
    monitoringSection: "Monitoring",
    pollingEnabled: "Polling enabled",
    pollingPaused: "Polling paused",
    pollingHint: "When paused, readings pushed by the router are discarded. History is kept.",
    /** Field names, used when the API reports which field failed validation. */
    fields: {
      quota_gb: "Quota (GB)",
      monthly_quota_gb: "Maximum consumption (GB)",
      billing_cycle_day: "Cycle starts on day",
      window_start: "Window start",
      window_end: "Window end",
      timezone: "Timezone",
      alert_email_to: "Alert email",
      wan_interface_name: "WAN interface name",
      polling_enabled: "Polling",
      language: "Alert language",
    },
  },

  export: {
    title: "Export readings",
    subtitle: "Download raw interface counter readings for a date range.",
    columnsHint:
      "Dates are inclusive and interpreted in the timezone from Settings. Columns: recorded_at (ISO 8601 UTC), tx_bytes, rx_bytes, total_bytes.",
    pickBothDates: "Pick both dates.",
    startBeforeEnd: "The start date must be on or before the end date.",
    downloadCsv: "Download CSV",
    downloadJson: "Download JSON",
  },

  email: {
    alertSubject: "Internet quota exceeded: {used} of {quota} used ({date})",
    alertHeading: "Internet quota exceeded",
    alertIntro: "Your home internet usage has exceeded the daily quota.",
    date: "Date",
    window: "Window",
    used: "Used",
    usedValue: "{used} ({percent}% of {quota})",
    onlyAlert: "This is the only alert you will receive for today.",
    testSubject: "Test alert from MikroTik quota monitor",
    testBody: "This is a test email sent at {time}. Alerts are working.",
  },


  /**
   * The alert email.
   *
   * Kept apart from `email` above, which covers only the wording shared with
   * the settings page. Every label here is padded into a column in the
   * plain-text body, so a label much longer than its English counterpart will
   * push that column wide rather than break it.
   */
  emailAlert: {
    brand: "Internet Monitor",
    testPrefix: "[Test] ",
    subjectExceeded: "Internet quota exceeded: {used} of {quota} ({percent}) on {date}",
    subjectReport: "Internet quota report: {used} of {quota} ({percent}) on {date}",

    introExceeded: "Your home internet usage has exceeded the daily quota.",
    introReport: "Daily quota report.",
    textTestBanner: "TEST PREVIEW - this is what a real quota alert looks like.",
    sectionToday: "TODAY",
    sectionCycle: "BILLING CYCLE",
    sectionWeek: "LAST 7 DAYS",
    sectionConnection: "CONNECTION",

    labels: {
      date: "Date",
      window: "Window",
      used: "Used",
      overBy: "Over by",
      download: "Download",
      upload: "Upload",
      peakRate: "Peak rate",
      averageRate: "Average rate",
      busiestHour: "Busiest hour",
      projected: "Projected",
      progress: "Progress",
      dailyAverage: "Daily average",
      budgetLeft: "Budget left",
      sessions: "Sessions",
      drops: "Drops",
      availability: "Availability",
      longestUp: "Longest up",
      meanUptime: "Mean uptime",
      heaviestDay: "Heaviest day",
    },

    textDate: "{date} ({timezone})",
    textWindow: "{start}-{end}",
    textUsed: "{used} of {quota} ({percent})",
    textProjected: "{projected} ({percent} of cap)",
    textProgress: "day {elapsed} of {total}, {remaining} left",
    textBudget: "{bytes} per remaining day",
    textMeanUptime: "{duration} between drops",
    textOverMarker: "  over",
    textDaysOver: "{over} of {measured} days over quota ({percent} compliant)",
    textDayAndBytes: "{day} ({bytes})",
    textBusiestHour: "{hour} ({bytes})",
    testFooter: "No alert state was changed by this test.",
    alertFooter: "This is the only alert you will receive for today.",
    dashboardLine: "Dashboard: {url}",

    testBannerLead: "Test preview.",
    testBannerRest:
      " This is exactly what a real quota alert looks like, filled with your live data. Nothing was flagged as alerted.",
    eyebrowExceeded: "Quota exceeded",
    eyebrowReport: "Daily quota report",
    ofDailyQuota: "of {quota} daily quota",
    overQuotaBy: "Over quota by",
    remainingToday: "Remaining today",
    quotaWindow: "Quota window",
    windowSpan: "{start} - {end}",
    todayTraffic: "Today's traffic",
    billingCycle: "Billing cycle",
    cycleOf: "of {cap}",
    cycleDayLine: "Day {elapsed} of {total}",
    cycleUsedSuffix: " used",
    projectedAtEnd: "Projected at cycle end",
    ofCapHint: "{percent} of cap",
    budgetPerDay: "Budget per remaining day",
    daysLeft: "{days} days left",
    cycleEndsToday: "cycle ends today",
    dailyAverageSoFar: "Daily average so far",
    cycleStatus: "Cycle status",
    overCap: "Over cap",
    withinCap: "Within cap",
    lastSevenDays: "Last 7 days",
    weekIntro: "Traffic inside the quota window. Red bars went over {quota}.",
    daysOverQuota: "Days over quota",
    ofCount: "{over} of {measured}",
    compliance: "Compliance",
    connectionHealth: "Connection health",
    connectionIntro: "Over the same seven days.",
    totalUptime: "Total uptime",
    longestSession: "Longest session",
    meanTimeBetweenDrops: "Mean time between drops",
    openDashboard: "Open the dashboard",
    preheaderOver: "{used} used of {quota} ({percent}) on {date}",
    preheaderUnder: "{used} used of {quota} on {date}",
    footerTest: "Test preview. No alert state was changed.",
    generatedLine: "Generated {at} · times shown in {timezone}",
  },

  errors: {
    badJson: "The request body must be JSON.",
    validationFailed: "Validation failed.",
    quotaPositive: "The daily quota must be greater than 0.",
    monthlyQuotaPositive: "The monthly cap must be greater than 0.",
    cycleDayWhole: "The cycle day must be a whole number.",
    cycleDayRange: "The cycle day must be between 1 and 31.",
    timeFormat: "The time must be written as HH:MM on a 24-hour clock.",
    unknownTimezone: "That is not a known IANA timezone.",
    invalidEmail: "That is not a valid email address.",
    interfaceRequired: "The interface name is required.",
    unknownLanguage: "That language is not supported.",
    windowOrder: "The end of the window must be after its start.",
    alertEmailMissing: "No alert email is saved. Save an alert email first.",
    exportFormat: "The format must be csv or json.",
    exportDates: "Both dates must be written as YYYY-MM-DD.",
    exportOrder: "The start date must be on or before the end date.",
    limitRange: "The limit must be a whole number between 1 and {max}.",
    daysRange: "The days must be a whole number between 1 and {max}.",
    tooManyIds: "At most {max} sessions may be selected at once.",
    notASessionId: "{value} is not a session id.",
    settingsNotSeeded:
      "The settings table has no row yet. Run schema.sql against the database to seed it.",
    emailFailed: "The alert email could not be sent.",
    internal: "Something went wrong on the server.",
    range: {
      unknownPreset: "{value} is not a range this application knows.",
      unknownBucket: "{value} is not a grouping this application knows.",
      customNeedsBoth: "A custom range needs both a start and an end.",
      customOrder: "The end of a custom range must be after its start.",
      badEndpoint: "{value} is not a date (YYYY-MM-DD) or a date and time (YYYY-MM-DDTHH:MM).",
      tooManyBuckets: "Grouping this range by {bucket} would produce more than {max} points.",
    },
  },
};

/**
 * The shape every language must fill.
 *
 * Inferred without `as const`, so each value is `string` rather than its own
 * literal: another dictionary is then checked on its keys, not on its wording.
 */
export type Dictionary = typeof en;
