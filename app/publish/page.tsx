import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/publish";

export default function PublishPage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
