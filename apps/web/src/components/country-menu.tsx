import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type Country, CountrySchema, LOCALE_LIST, localeFor } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  SidebarItem,
  toast,
} from "@tj/ui";
import { Globe } from "lucide-react";
import { accountSettingsQuery, setCountryMutation } from "@/lib/account-settings";

const COUNTRY_ICON = <Globe size={16} strokeWidth={1.5} />;
/** The countries that write exactly as England does today (same spelling, money and units). */
const UK = new Set<Country>(["england", "wales", "scotland", "northern-ireland"]);

/**
 * The account's country (TEACH-33 part b, ruling 183), beside Theme in the sidebar foot and built
 * the same way. It sets spelling, currency and units for new lessons; saved lessons keep theirs.
 */
export function CountryMenu() {
  const queryClient = useQueryClient();
  const { data } = useQuery(accountSettingsQuery);
  const { mutate } = useMutation({
    ...setCountryMutation(queryClient),
    onError: () => toast("Could not save your country. Try again."),
  });
  const country = data?.country ?? "england";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarItem icon={COUNTRY_ICON}>Country</SidebarItem>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-64">
        <DropdownMenuLabel>Country for new lessons</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={country}
          onValueChange={(value) => {
            const parsed = CountrySchema.safeParse(value);
            if (parsed.success && parsed.data !== country) mutate(parsed.data);
          }}
        >
          {LOCALE_LIST.map((locale) => (
            <DropdownMenuRadioItem key={locale.country} value={locale.country}>
              {locale.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {UK.has(country)
            ? "Sets spelling, currency and units. Lessons you have made keep theirs."
            : `Spelling, currency and units follow ${localeFor(country).label}. Year groups and the curriculum stay England's for now.`}
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
