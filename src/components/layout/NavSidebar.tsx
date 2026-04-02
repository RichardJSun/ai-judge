'use client';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import GavelIcon from '@mui/icons-material/Gavel';
import ListAltIcon from '@mui/icons-material/ListAlt';
import {
  Box,
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import ThemeModeControl from '@/components/ui/ThemeModeControl';
import { SectionSurface } from '@/components/ui/editorial';
import { editorialRadius, shellTypography } from '@/components/ui/theme';
import { navSidebarDrawerSx, navSidebarSurfaceHeightSx } from './shell-layout';

const navItems = [
  { label: 'Upload', href: '/upload', icon: <CloudUploadIcon /> },
  { label: 'Queues', href: '/queues', icon: <ListAltIcon /> },
  { label: 'Judges', href: '/judges', icon: <GavelIcon /> },
];

interface NavSidebarProps {
  variant?: 'permanent' | 'temporary';
  open?: boolean;
  onClose?: () => void;
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <SectionSurface
      sx={{
        height: navSidebarSurfaceHeightSx,
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        position: { lg: 'sticky' },
        top: { lg: 16 },
        '&::before': {
          opacity: 0.24,
        },
      }}
    >
      <Stack spacing={3} sx={{ height: '100%' }}>
        <Box px={0.75}>
          <Stack direction="row" spacing={1.25} alignItems="center" mb={1.5}>
            <Box
              sx={{
                width: 42,
                height: 42,
                borderRadius: `${editorialRadius.control}px`,
                display: 'grid',
                placeItems: 'center',
                color: 'primary.contrastText',
                background: 'linear-gradient(135deg, var(--ai-judge-palette-primary-dark), var(--ai-judge-palette-primary-main))',
                boxShadow: '0 12px 26px color-mix(in srgb, var(--ai-judge-palette-primary-main) 26%, transparent)',
              }}
            >
              <Typography variant="subtitle2" component="span">
                AJ
              </Typography>
            </Box>
            <Box minWidth={0}>
              <Typography
                component="p"
                sx={{
                  ...shellTypography.brandTitle,
                  fontSize: { xs: '1.5rem', lg: '1.6rem' },
                }}
              >
                AI Judge
              </Typography>
              <Typography
                component="span"
                color="text.secondary"
                sx={{
                  ...shellTypography.metaLabel,
                  display: 'block',
                }}
              >
                Editorial ops desk
              </Typography>
            </Box>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5, maxWidth: 180 }}>
            Review queues, judges, and results from one workspace.
          </Typography>
        </Box>

        <Divider />

        <List dense sx={{ px: 0.5 }}>
          {navItems.map(({ label, href, icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);

            return (
              <ListItem key={href} disablePadding sx={{ mb: 0.5 }}>
                <ListItemButton
                  component={Link}
                  href={href}
                  selected={active}
                  onClick={onNavigate}
                  sx={(theme) => {
                    const primary = theme.vars?.palette.primary.main ?? theme.palette.primary.main;
                    const paper = theme.vars?.palette.background.paper ?? theme.palette.background.paper;

                    return {
                      minHeight: 52,
                      borderRadius: `${editorialRadius.control}px`,
                      px: 1.25,
                      color: active ? 'text.primary' : 'text.secondary',
                      transition: `transform 120ms cubic-bezier(0.23, 1, 0.32, 1), background-color 180ms cubic-bezier(0.23, 1, 0.32, 1), color 180ms cubic-bezier(0.23, 1, 0.32, 1)`,
                      '& .MuiListItemIcon-root': {
                        minWidth: 40,
                        color: active ? 'primary.main' : 'inherit',
                      },
                      '& .MuiListItemText-primary': {
                        fontWeight: active ? 700 : 600,
                      },
                      '&.Mui-selected': {
                        backgroundColor: `color-mix(in srgb, ${primary} 10%, ${paper})`,
                      },
                      '&.Mui-selected:hover': {
                        backgroundColor: `color-mix(in srgb, ${primary} 14%, ${paper})`,
                      },
                      '&:hover': {
                        backgroundColor: `color-mix(in srgb, ${primary} 7%, ${paper})`,
                      },
                    };
                  }}
                >
                  <ListItemIcon>{icon}</ListItemIcon>
                  <ListItemText primary={label} />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>

        <Box flexGrow={1} />

        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
          sx={{
            px: 1,
            py: 1.25,
            borderRadius: `${editorialRadius.control}px`,
            bgcolor: 'action.hover',
          }}
        >
          <Box>
            <Typography
              component="span"
              color="text.secondary"
              sx={{
                ...shellTypography.metaLabel,
                display: 'block',
              }}
            >
              Appearance
            </Typography>
            <Typography variant="body2" fontWeight={600}>
              Light, dark, or system
            </Typography>
          </Box>
          <ThemeModeControl />
        </Stack>
      </Stack>
    </SectionSurface>
  );
}

export default function NavSidebar({
  variant = 'permanent',
  open = false,
  onClose = () => undefined,
}: NavSidebarProps) {
  return (
    <Drawer
      variant={variant}
      open={variant === 'temporary' ? open : true}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={navSidebarDrawerSx}
    >
      <SidebarContent onNavigate={variant === 'temporary' ? onClose : undefined} />
    </Drawer>
  );
}
