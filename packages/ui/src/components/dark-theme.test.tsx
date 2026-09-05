import { describe, expect, it } from "bun:test";
import { render } from "@testing-library/react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AppBar,
  AppBarTitle,
  Button,
  Card,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  Display,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  EmptyState,
  IconButton,
  IconGroup,
  Input,
  Kbd,
  Label,
  ListSurface,
  ListSurfaceCell,
  ListSurfaceHeader,
  ListSurfaceRow,
  PageTitle,
  Popover,
  PopoverContent,
  RadioGroup,
  RadioGroupItem,
  SearchInput,
  SectionHeading,
  Select,
  Separator,
  Sidebar,
  SidebarItem,
  Skeleton,
  Spinner,
  Stack,
  StatusPill,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  Textarea,
  ThemeProvider,
  Tile,
  Toaster,
  Tooltip,
  TooltipProvider,
} from "../index";

describe("dark theme primitive smoke", () => {
  it("renders every shell primitive without throwing", () => {
    const { container } = render(
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <div data-theme="dark">
            <Button>Button</Button>
            <AppBar>
              <AppBarTitle>Title</AppBarTitle>
            </AppBar>
            <Card>Card</Card>
            <Input aria-label="Input" />
            <Display>Display</Display>
            <SectionHeading>Section</SectionHeading>
            <PageTitle label="Title" renameLabel="Rename">
              Page title
            </PageTitle>
            <Tile icon={<span />}>New lesson</Tile>
            <EmptyState title="Nothing here" />
            <StatusPill>Draft</StatusPill>
            <Stack width={160} sheets={[<span key="front" />]} />
            <ListSurface
              header={
                <ListSurfaceHeader>
                  <ListSurfaceCell header>Name</ListSurfaceCell>
                </ListSurfaceHeader>
              }
            >
              <ListSurfaceRow>
                <ListSurfaceCell>Lesson</ListSurfaceCell>
              </ListSurfaceRow>
            </ListSurface>
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
            <Tooltip label="Tip">
              <button type="button">Tip</button>
            </Tooltip>
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
            <IconGroup aria-label="Actions">
              <IconButton label="More" noTooltip>
                <span />
              </IconButton>
            </IconGroup>
            <SearchInput label="Search" placeholder="Search" value="" onChange={() => {}} />
            <Sidebar aria-label="Library" wordmark="TeachDeck">
              <SidebarItem icon={<span />}>Home</SidebarItem>
            </Sidebar>
            <Spinner />
            <Toaster />
          </div>
        </TooltipProvider>
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-theme="dark"]')).toBeInTheDocument();
  });
});
