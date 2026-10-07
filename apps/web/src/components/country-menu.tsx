import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CountrySchema, LOCALE_LIST } from "@tj/domain/documents";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  SidebarItem,
  toast,
} from "@tj/ui";
import { Globe } from "lucide-react";
import { useEffect } from "react";
import { accountSettingsQuery, hintCountry, setCountryMutation } from "@/lib/account-settings";

const COUNTRY_ICON = <Globe size={16} strokeWidth={1.5} />;

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
  const unset = data?.chosen === false;
  // A new account (no country yet): geolocate it once, through the web's edge function.
  useEffect(() => {
    if (unset) void hintCountry(queryClient).catch(() => {});
  }, [unset, queryClient]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarItem icon={COUNTRY_ICON}>Country</SidebarItem>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
