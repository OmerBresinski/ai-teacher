import { Button, IconButton, IconGroup, Kbd, KbdGroup, Spinner, Tile } from "@tj/ui";
import { Copy, FileText, Layers, Plus, Presentation } from "lucide-react";
import { KitGroup, Specimen, Variant } from "./frame";

const buttonVariants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
const buttonSizes = ["xs", "sm", "default", "lg"] as const;

export function Actions() {
  return (
    <KitGroup id="actions" title="Actions">
      <Specimen
        name="Button, every variant and size"
        note="Primary actions, quiet actions, links, disabled and icon states."
      >
        <div className="space-y-4">
          {buttonVariants.map((variant) => (
            <Variant key={variant} label={variant} grow>
              <div className="flex flex-wrap items-center gap-2">
                {buttonSizes.map((size) => (
                  <Button key={size} variant={variant} size={size}>
                    {size}
                  </Button>
                ))}
                <Button variant={variant} size="default">
                  <Plus aria-hidden />
                  With icon
                </Button>
              </div>
            </Variant>
          ))}
          <Variant label="Disabled">
            <Button disabled>Disabled</Button>
          </Variant>
        </div>
      </Specimen>
      <Specimen name="IconButton, states" note="Small, medium and active controls remain named.">
        <Variant label="Small">
          <IconButton label="Copy, small" size="sm" noTooltip>
            <Copy aria-hidden />
          </IconButton>
        </Variant>
        <Variant label="Medium">
          <IconButton label="Copy, medium" size="md" noTooltip>
            <Copy aria-hidden />
          </IconButton>
        </Variant>
        <Variant label="Active">
          <IconButton label="Copy, active" active noTooltip>
            <Copy aria-hidden />
          </IconButton>
        </Variant>
      </Specimen>
      <Specimen name="IconGroup" note="A grouped pair of related icon controls.">
        <IconGroup aria-label="Kit actions">
          <IconButton label="Copy" noTooltip>
            <Copy aria-hidden />
          </IconButton>
          <IconButton label="Add" noTooltip>
            <Plus aria-hidden />
          </IconButton>
        </IconGroup>
      </Specimen>
      <Specimen name="Tile, default and primary" bleed>
        <div className="grid w-full gap-3 sm:grid-cols-2">
          <Tile icon={<FileText aria-hidden />}>New worksheet</Tile>
          <Tile tone="primary" icon={<Presentation aria-hidden />}>
            New lesson
          </Tile>
          <Tile icon={<Layers aria-hidden />} disabled>
            Disabled tile
          </Tile>
        </div>
      </Specimen>
      <Specimen name="Kbd and Spinner" note="Keyboard hints and decorative pending state.">
        <Variant label="Kbd group">
          <KbdGroup>
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Variant>
        <Variant label="Spinner 16px">
          <Spinner size={16} />
        </Variant>
        <Variant label="Spinner 20px">
          <Spinner size={20} />
        </Variant>
      </Specimen>
    </KitGroup>
  );
}
