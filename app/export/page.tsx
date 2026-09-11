import { ExportForm } from "@/components/ExportForm";

export const metadata = { title: "Export - MikroTik Quota Monitor" };

export default function ExportPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Export readings</h1>
        <p className="text-sm text-muted">Download raw interface counter readings for a date range.</p>
      </div>
      <ExportForm />
    </div>
  );
}
