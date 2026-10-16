// Numbers and expressions shared by the recorder and the workplane builder.
/** A parameter written as an expression over the part's variables, e.g. expr('w/2'). */
export class Expr { constructor(public text: string, public value: number) {} valueOf(): number { return this.value; } }
export type Num = number | Expr;
export const num = (n: Num): number => (n instanceof Expr ? n.value : n);
export const ref = (n: Num): number | string => (n instanceof Expr ? `=${n.text}` : n);
