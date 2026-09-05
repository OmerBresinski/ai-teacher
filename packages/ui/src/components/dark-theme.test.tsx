import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  Input,
  Kbd,
  Label,
  Popover,
  PopoverContent,
  RadioGroup,
  RadioGroupItem,
  Select,
  Separator,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeProvider,
  Toaster,
  Tooltip,
  TooltipProvider,
} from "../index";

describe("dark theme primitive smoke", () => {
  it("renders every shell primitive without throwing", () => {
    const { container } = render(
      <ThemeProvider defaultTheme="dark">
        <div data-theme="dark">
          <Button>Button</Button>
          <Card>Card</Card>
          <Input aria-label="Input" />
          <Dialog open>
            <DialogContent>
              <DialogTitle>Dialog</DialogTitle>
            </DialogContent>
          </Dialog>
          <AlertDialog open>
            <AlertDialogContent>
              <AlertDialogTitle>Alert</AlertDialogTitle>
            </AlertDialogContent>
          </AlertDialog>
          <DropdownMenu open>
            <DropdownMenuContent>
              <DropdownMenuItem>Menu</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover open>
            <PopoverContent>Popover</PopoverContent>
          </Popover>
          <TooltipProvider>
            <Tooltip label="Tip">
              <button type="button">Tip</button>
            </Tooltip>
          </TooltipProvider>
          <Tabs defaultValue="one">
            <TabsList>
              <TabsTrigger value="one">One</TabsTrigger>
            </TabsList>
          </Tabs>
          <Switch aria-label="Switch" />
          <Checkbox aria-label="Checkbox" />
          <RadioGroup>
            <RadioGroupItem aria-label="Radio" value="one" />
          </RadioGroup>
          <Select />
          <Textarea aria-label="Textarea" />
          <Skeleton />
          <Separator />
          <Kbd>K</Kbd>
          <Label>Label</Label>
          <Spinner />
          <Toaster />
        </div>
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-theme="dark"]')).toBeInTheDocument();
  });
});
