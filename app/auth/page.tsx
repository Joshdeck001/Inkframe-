import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/auth";

export default function AuthPage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
