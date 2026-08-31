import LegacyPage from "@/lib/LegacyPage";
import { title, css, bodyHtml, script } from "@/content/advertising";

export default function AdvertisingPage() {
  return <LegacyPage title={title} css={css} bodyHtml={bodyHtml} script={script} />;
}
