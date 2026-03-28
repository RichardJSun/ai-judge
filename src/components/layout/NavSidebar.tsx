'use client';

import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import GavelIcon from '@mui/icons-material/Gavel';
import ListAltIcon from '@mui/icons-material/ListAlt';
import {
  Divider,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { navSidebarDrawerSx } from './shell-layout';

const navItems = [
  { label: 'Upload', href: '/upload', icon: <CloudUploadIcon /> },
  { label: 'Queues', href: '/queues', icon: <ListAltIcon /> },
  { label: 'Judges', href: '/judges', icon: <GavelIcon /> },
];

export default function NavSidebar() {
  const pathname = usePathname();

  return (
    <Drawer variant="permanent" sx={navSidebarDrawerSx}>
      <Toolbar>
        <Typography variant="h6" fontWeight={700} color="primary">
          AI Judge
        </Typography>
      </Toolbar>
      <Divider />
      <List dense>
        {navItems.map(({ label, href, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/');
          return (
            <ListItem key={href} disablePadding>
              <ListItemButton
                component={Link}
                href={href}
                selected={active}
                sx={{ borderRadius: 1, mx: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: active ? 'primary.main' : 'inherit' }}>
                  {icon}
                </ListItemIcon>
                <ListItemText primary={label} />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
    </Drawer>
  );
}
