import {
  AppBar,
  AppBarGroup,
  AppBarTitle,
  Button,
  Display,
  ListSurface,
  ListSurfaceCell,
  ListSurfaceHeader,
  ListSurfaceRow,
  Sidebar,
  SidebarItem,
  selectionCardVariants,
  toolbarButtonVariants,
} from "@tj/ui";
import { ChevronDown, FileText, House, Presentation } from "lucide-react";
import { useState } from "react";
import { KitGroup, Specimen, Variant } from "./frame";
import { GeneratingExhibit } from "./generating";

export function Chrome() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <KitGroup
      id="chrome"
      title="Chrome"
      rule="Bars are 48px on the card surface with a hairline below, one primary at the right. The sidebar is sticky and full height; its active item takes the accent tint with an accent-text glyph."
    >
      <Specimen name="AppBar" note="The lesson name at the left, Present at the right." bleed>
        <div className="w-full overflow-hidden rounded-card border border-border">
          <AppBar>
            <AppBarGroup>
              <AppBarTitle>The water cycle</AppBarTitle>
            </AppBarGroup>
            <AppBarGroup className="ml-auto">
              <Button variant="primary" size="sm">
                Present
              </Button>
            </AppBarGroup>
          </AppBar>
        </div>
      </Specimen>
      <Specimen
        name="AppBar, narrowed"
        note="The worksheet editor caps the bar at the page width."
        bleed
      >
        <div className="w-full overflow-hidden rounded-card border border-border">
          <AppBar maxWidth={480}>
            <AppBarGroup>
              <AppBarTitle>Fractions worksheet</AppBarTitle>
            </AppBarGroup>
          </AppBar>
        </div>
      </Specimen>
      <Specimen
        name="Editor controls"
        note="Shared recipes used by the lesson toolbar and worksheet source selection."
      >
        <div className="flex flex-col items-start gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={toolbarButtonVariants()}>
              Bold
            </button>
            <button type="button" className={toolbarButtonVariants({ kind: "dropdown" })}>
              Paragraph
              <ChevronDown aria-hidden />
            </button>
          </div>
          <div className="grid w-full grid-cols-2 gap-3">
            <button
              type="button"
              aria-pressed
              className={selectionCardVariants({
                selected: true,
                className: "min-w-40 flex-col gap-1 p-3",
              })}
            >
              <span className="font-semibold">Selected lesson</span>
              <span className="text-meta text-ink-3">Year 7 · Science</span>
            </button>
            <button
              type="button"
              aria-pressed="false"
              className={selectionCardVariants({
                selected: false,
                className: "min-w-40 flex-col gap-1 p-3",
              })}
            >
              <span className="font-semibold">Available lesson</span>
              <span className="text-meta text-ink-3">Year 8 · Geography</span>
            </button>
          </div>
        </div>
      </Specimen>
      <Specimen name="Sidebar, expanded and collapsed" bleed>
        <div className="flex flex-wrap gap-6">
          <Variant label="Expanded">
            <div className="h-80 overflow-hidden rounded-card border border-border">
              <Sidebar
                className="relative h-full"
                aria-label="Kit sidebar"
                collapsed={collapsed}
                onCollapsedChange={setCollapsed}
                wordmark={
                  <Display as="span" size="md">
                    Workspace
                  </Display>
                }
                mark={
                  <Display as="span" size="md">
                    W
                  </Display>
                }
                foot={<SidebarItem icon={<FileText aria-hidden />}>Import</SidebarItem>}
              >
                <SidebarItem icon={<House aria-hidden />} active>
                  Home
                </SidebarItem>
                <SidebarItem icon={<Presentation aria-hidden />}>Lessons</SidebarItem>
              </Sidebar>
            </div>
          </Variant>
          <Variant label="Collapsed">
            <div className="h-80 overflow-hidden rounded-card border border-border">
              <Sidebar
                className="relative h-full"
                aria-label="Collapsed kit sidebar"
                collapsed
                mark={
                  <Display as="span" size="md">
                    W
                  </Display>
                }
              >
                <SidebarItem icon={<House aria-hidden />}>Home</SidebarItem>
              </Sidebar>
            </div>
          </Variant>
        </div>
      </Specimen>
      <Specimen name="ListSurface, header and rows" note="The list view of the library." bleed>
        <ListSurface
          aria-label="Kit list"
          header={
            <ListSurfaceHeader>
              <ListSurfaceCell header>Title</ListSurfaceCell>
              <ListSurfaceCell header>Type</ListSurfaceCell>
            </ListSurfaceHeader>
          }
        >
          <ListSurfaceRow>
            <ListSurfaceCell>Fractions, week 3</ListSurfaceCell>
            <ListSurfaceCell>Lesson</ListSurfaceCell>
          </ListSurfaceRow>
          <ListSurfaceRow>
            <ListSurfaceCell>The water cycle</ListSurfaceCell>
            <ListSurfaceCell>Worksheet</ListSurfaceCell>
          </ListSurfaceRow>
        </ListSurface>
      </Specimen>
      <GeneratingExhibit />
    </KitGroup>
  );
}
