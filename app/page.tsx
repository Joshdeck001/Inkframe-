import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/index";

export default function Home() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
