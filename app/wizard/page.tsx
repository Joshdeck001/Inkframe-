import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/wizard";

export default function WizardPage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
