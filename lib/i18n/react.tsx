import { Fragment, type ReactNode } from "react";

/**
 * Interpolation where the values are markup rather than text.
 *
 * A sentence like "Check {variable} and run {file}" has to stay one string in
 * the dictionary: a translator needs the whole sentence to order it correctly,
 * and Arabic orders it differently from English. So the placeholders are filled
 * with nodes here instead of being split into fragments the dictionary would
 * have to keep in English order.
 *
 * Used from Server and Client Components alike, so it holds no state and opens
 * no boundary of its own.
 */
export function Interpolate({
  template,
  values,
}: {
  template: string;
  values: Record<string, ReactNode>;
}) {
  const parts = template.split(/(\{\w+\})/g);
  return (
    <>
      {parts.map((part, index) => {
        const match = /^\{(\w+)\}$/.exec(part);
        const value = match ? values[match[1]] : undefined;
        return <Fragment key={index}>{value === undefined ? part : value}</Fragment>;
      })}
    </>
  );
}
