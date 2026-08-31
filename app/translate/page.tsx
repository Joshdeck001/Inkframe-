import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/translate";

export default function TranslatePage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
