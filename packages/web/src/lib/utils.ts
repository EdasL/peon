import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

const API_KEY_ERROR_RE =
  /api[_\s-]?key|authentication[_\s]?(failed|error)|connect your .* account|invalid x-api-key|incorrect api key|No API key found/i

export function isApiKeyError(message: string | null | undefined): boolean {
  if (!message) return false
  return API_KEY_ERROR_RE.test(message)
}
