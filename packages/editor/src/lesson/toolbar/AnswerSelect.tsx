import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@tj/ui";

export type AnswerSelectProps = {
  id: string;
  /** Sizes the trigger; the drawer's fallback takes the same box, so nothing shifts. */
  className: string;
  "aria-label": string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
};

/**
 * The pickers in the "Answer" popover (true/false, matching, image matching). They are the only
 * Radix Select in a teacher's editor outside the Info popover, so this module loads on the drawer's
 * first hover, focus or open instead of with the editor's first paint (TEACH-113 route budget). It
 * imports nothing the other routes share, so its chunk does not re-partition theirs.
 */
export function AnswerSelect({
  id,
  className,
  "aria-label": ariaLabel,
  value,
  options,
  onChange,
}: AnswerSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className={className} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
