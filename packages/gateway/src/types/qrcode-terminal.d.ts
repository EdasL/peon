declare module "qrcode-terminal" {
  export function generate(text: string, callback?: (qrcode: string) => void): void;
  export function generate(
    text: string,
    options: { small?: boolean },
    callback?: (qrcode: string) => void,
  ): void;
  export function setErrorLevel(level: string): void;
}
