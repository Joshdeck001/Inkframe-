import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/dashboard";

export default function DashboardPage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
