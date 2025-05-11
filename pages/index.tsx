import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, LinkIcon, Wand2 } from "lucide-react";

export default function RSSChecker() {
  const [url, setUrl] = useState("https://");
  const [status, setStatus] = useState("idle");
  const [rssLink, setRssLink] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [generatedRss, setGeneratedRss] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<Record<string, unknown> | null>(null);
  const [triedSelectors, setTriedSelectors] = useState<string[]>([]);

  const checkRSS = async () => {
    setStatus("loading");
    setRssLink(null);
    setGeneratedRss(null);
    setMessage("");
    setDebugInfo(null);
    setTriedSelectors([]);

    try {
      const res = await fetch(`/api/check-rss?url=${encodeURIComponent(url)}`);
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/xml") || contentType.includes("text/xml")) {
        setRssLink(url);
        setStatus("found");
        return;
      }

      const data = await res.json();

      if (data.rss) {
        setRssLink(data.rss);
        setStatus("found");
      } else {
        setStatus("not-found");
        setMessage("このサイトには有効なRSSが見つかりませんでした。代わりにRSSを作成しますか？");
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStatus("error");
        setMessage(`チェック中にエラーが発生しました: ${err.message}`);
      } else {
        setStatus("error");
        setMessage("チェック中に不明なエラーが発生しました");
      }
    }
  };

  const generateRSS = async () => {
    setStatus("generating");
    setGeneratedRss(null);
    setDebugInfo(null);
    setTriedSelectors([]);

    try {
      const res = await fetch(`/api/generate-rss?url=${encodeURIComponent(url)}`);
      const data = await res.json();

      if (data.rss) {
        setGeneratedRss(data.rss);
        setStatus("generated");
      } else {
        setStatus("error");
        setMessage(data.error || "RSSの生成に失敗しました。");
        setDebugInfo(data.debug || null);
        setTriedSelectors(data.triedSelectors || []);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setStatus("error");
        setMessage(`RSSの生成中にエラーが発生しました: ${err.message}`);
      } else {
        setStatus("error");
        setMessage("RSSの生成中に不明なエラーが発生しました");
      }
    }
  };

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">RSSチェッカー</h1>
      <Input
        type="url"
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
      />
      <Button onClick={checkRSS} disabled={status === "loading"}>
        {status === "loading" ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
        チェックする
      </Button>

      {status === "found" && rssLink && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-green-600 font-medium">RSSが見つかりました！</p>
            <a href={rssLink} className="text-blue-600 underline flex items-center" target="_blank" rel="noreferrer">
              <LinkIcon className="mr-2 h-4 w-4" /> {rssLink}
            </a>
          </CardContent>
        </Card>
      )}

      {status === "not-found" && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-red-600">{message}</p>
            <Button onClick={generateRSS} variant="outline" disabled={status === "generating"}>
              {status === "generating" ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  実行中...
                </>
              ) : (
                <>
                  <Wand2 className="mr-2 h-4 w-4" />
                  RSSを生成する
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "generated" && generatedRss && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <p className="text-green-600 font-medium">RSSを生成しました！</p>
            <a href={generatedRss} className="text-blue-600 underline flex items-center" target="_blank" rel="noreferrer">
              <LinkIcon className="mr-2 h-4 w-4" /> {generatedRss}
            </a>
          </CardContent>
        </Card>
      )}

      {status === "error" && (
        <Card>
          <CardContent className="p-4 text-red-600 space-y-2">
            <p>{message}</p>

            {triedSelectors.length > 0 && (
              <div>
                <p className="font-semibold text-black mt-2">試したセレクタ:</p>
                <ul className="list-disc list-inside text-black">
                  {triedSelectors.map((sel, idx) => (
                    <li key={idx}><code>{sel}</code></li>
                  ))}
                </ul>
              </div>
            )}

            {debugInfo && (
              <div className="text-black">
                <p className="font-semibold mt-2">デバッグ情報:</p>
                <pre className="whitespace-pre-wrap break-all bg-gray-100 p-2 rounded text-xs">
                  {JSON.stringify(debugInfo, null, 2)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
