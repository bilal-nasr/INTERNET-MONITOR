/**
 * A script that runs while the server's HTML is parsed, and never otherwise.
 *
 * A script React renders in the browser does not execute, and React warns about
 * it in development. That happens here whenever the root layout mounts again on
 * the client, which switching language does. Rendering the tag as `text/plain`
 * in the browser keeps it inert there without the warning, while the server
 * HTML still carries a real `text/javascript` script for the first load;
 * suppressHydrationWarning accepts the difference in `type`. The pattern is the
 * one in Next's "preventing flash before hydration" guide.
 */
export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
