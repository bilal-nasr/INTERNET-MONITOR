import type { Metadata } from "next";
import { ExportForm } from "@/components/ExportForm";
import { ImportForm } from "@/components/ImportForm";
import { getI18n } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const { d } = await getI18n();
  return { title: `${d.export.title} - ${d.meta.appName}` };
}

export default async function ExportPage() {
  const { d } = await getI18n();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{d.export.title}</h1>
        <p className="text-sm text-muted">{d.export.subtitle}</p>
      </div>
      <ExportForm />
      <ImportForm />
    </div>
  );
}
