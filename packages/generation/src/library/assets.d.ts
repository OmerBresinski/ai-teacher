// Bun imports the prompt-engineer's words as text (`with { type: "text" }`).
declare module "*.txt" {
  const text: string;
  export default text;
}
