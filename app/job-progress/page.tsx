import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/job-progress";

export default function JobProgressPage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
