import {
  Alert02Icon as HugeTriangleAlertIcon,
  AlertCircleIcon as HugeCircleAlertIcon,
  AlignEndHorizontalIcon as HugeAlignEndHorizontalIcon,
  AlignEndVerticalIcon as HugeAlignEndVerticalIcon,
  AlignHorizontalCenterIcon as HugeAlignCenterHorizontalIcon,
  AlignHorizontalSpaceAroundIcon as HugeAlignHorizontalSpaceAroundIcon,
  AlignHorizontalSpaceBetweenIcon as HugeAlignHorizontalSpaceBetweenIcon,
  AlignStartHorizontalIcon as HugeAlignStartHorizontalIcon,
  AlignStartVerticalIcon as HugeAlignStartVerticalIcon,
  AlignVerticalCenterIcon as HugeAlignCenterVerticalIcon,
  BotIcon as HugeBotIcon,
  BracesIcon as HugeBracesIcon,
  BringToFrontIcon as HugeBringToFrontIcon,
  Cancel01Icon as HugeXIcon,
  CheckIcon as HugeCheckIcon,
  ChevronDownIcon as HugeChevronDownIcon,
  ChevronLeftIcon as HugeChevronLeftIcon,
  ChevronRightIcon as HugeChevronRightIcon,
  ChevronsDownUpIcon as HugeChevronsUpDownIcon,
  ChevronUpIcon as HugeChevronUpIcon,
  CircleCheckIcon as HugeCircleCheckIcon,
  CircleIcon as HugeCircleIcon,
  ClipboardIcon as HugeClipboardIcon,
  ClipboardPasteIcon as HugeClipboardPasteIcon,
  ClockIcon as HugeClockIcon,
  CodeIcon as HugeCodeIcon,
  CodeXmlIcon as HugeCodeXmlIcon,
  CommandIcon as HugeCommandIcon,
  ComponentIcon as HugeComponentIcon,
  Copy01Icon as HugeCopyIcon,
  CreditCardIcon as HugeCreditCardIcon,
  Cursor01Icon as HugeMousePointerIcon,
  Delete02Icon as HugeTrashIcon,
  Download01Icon as HugeDownloadIcon,
  EllipsisIcon as HugeEllipsisIcon,
  ExternalLinkIcon as HugeExternalLinkIcon,
  EyeIcon as HugeEyeIcon,
  EyeOffIcon as HugeEyeOffIcon,
  FileAddIcon as HugeFilePlusIcon,
  FileCodeIcon as HugeFileCodeIcon,
  FileImportIcon as HugeImportIcon,
  Folder01Icon as HugeFolderIcon,
  FrameIcon as HugeFrameIcon,
  GitBranchIcon as HugeGitBranchIcon,
  GitMergeIcon as HugeGitMergeIcon,
  Github01Icon as HugeGithubIcon,
  Globe02Icon as HugeGlobeIcon,
  GripVerticalIcon as HugeGripVerticalIcon,
  GroupIcon as HugeGroupIcon,
  HandIcon as HugeHandIcon,
  HistoryIcon as HugeHistoryIcon,
  HorizontalResizeIcon as HugeStretchHorizontalIcon,
  Image01Icon as HugeImageIcon,
  ImageAddIcon as HugeImagePlusIcon,
  InformationCircleIcon as HugeInfoIcon,
  Layers01Icon as HugeLayersIcon,
  LayoutGridIcon as HugeLayoutGridIcon,
  LayoutLeftIcon as HugePanelsTopLeftIcon,
  Link02Icon as HugeLinkIcon,
  ListTreeIcon as HugeListTreeIcon,
  ListViewIcon as HugeListIcon,
  LockIcon as HugeLockIcon,
  LockOpen as HugeUnlockIcon,
  Logout01Icon as HugeLogOutIcon,
  Maximize01Icon as HugeMaximizeIcon,
  MinusSignIcon as HugeMinusIcon,
  Moon02Icon as HugeMoonIcon,
  MoreHorizontalIcon as HugeMoreHorizontalIcon,
  PanelRightIcon as HugePanelRightIcon,
  PanelLeftIcon as HugePanelLeftIcon,
  PencilEdit01Icon as HugePencilIcon,
  Plug02Icon as HugeUnplugIcon,
  PlusSignIcon as HugePlusIcon,
  Redo02Icon as HugeRedoIcon,
  Refresh01Icon as HugeRefreshIcon,
  RotateLeft01Icon as HugeRotateCcwIcon,
  Scissor01Icon as HugeScissorsIcon,
  Search01Icon as HugeSearchIcon,
  SearchAddIcon as HugeZoomInIcon,
  SearchMinusIcon as HugeZoomOutIcon,
  QrCode01Icon as HugeQrCodeIcon,
  SendToBackIcon as HugeSendToBackIcon,
  SentIcon as HugeSendIcon,
  Settings01Icon as HugeSettingsIcon,
  Share01Icon as HugeShareIcon,
  ShieldKeyIcon as HugeShieldKeyIcon,
  SidebarBottomIcon as HugePanelBottomIcon,
  SlidersHorizontalIcon as HugeSlidersHorizontalIcon,
  SquareIcon as HugeSquareIcon,
  Sun01Icon as HugeSunIcon,
  TextAlignCenterIcon as HugeAlignCenterIcon,
  TextAlignJustifyLeftIcon as HugeAlignJustifyIcon,
  TextAlignLeftIcon as HugeAlignLeftIcon,
  TextAlignRightIcon as HugeAlignRightIcon,
  TextIcon as HugeTypeIcon,
  Undo02Icon as HugeUndoIcon,
  UngroupIcon as HugeUngroupIcon,
  Unlink01Icon as HugeUnlinkIcon,
  Unlink02Icon as HugeUnlink2Icon,
} from '@hugeicons/core-free-icons'
import {
  HugeiconsIcon,
  type HugeiconsIconProps,
  type IconSvgElement,
} from '@hugeicons/react'
import { forwardRef } from 'react'

export type IconProps = Omit<HugeiconsIconProps, 'icon'>

function createIcon(icon: IconSvgElement, displayName: string) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(
    ({ size = 16, strokeWidth = 1.5, ...props }, ref) => (
      <HugeiconsIcon
        ref={ref}
        icon={icon}
        size={size}
        strokeWidth={strokeWidth}
        {...props}
      />
    ),
  )
  Icon.displayName = displayName
  return Icon
}

export const AlignCenterHorizontalIcon = createIcon(
  HugeAlignCenterHorizontalIcon,
  'AlignCenterHorizontalIcon',
)
export const AlignCenterIcon = createIcon(HugeAlignCenterIcon, 'AlignCenterIcon')
export const AlignCenterVerticalIcon = createIcon(
  HugeAlignCenterVerticalIcon,
  'AlignCenterVerticalIcon',
)
export const AlignEndHorizontalIcon = createIcon(
  HugeAlignEndHorizontalIcon,
  'AlignEndHorizontalIcon',
)
export const AlignEndVerticalIcon = createIcon(
  HugeAlignEndVerticalIcon,
  'AlignEndVerticalIcon',
)
export const AlignHorizontalSpaceAroundIcon = createIcon(
  HugeAlignHorizontalSpaceAroundIcon,
  'AlignHorizontalSpaceAroundIcon',
)
export const AlignHorizontalSpaceBetweenIcon = createIcon(
  HugeAlignHorizontalSpaceBetweenIcon,
  'AlignHorizontalSpaceBetweenIcon',
)
export const AlignJustifyIcon = createIcon(HugeAlignJustifyIcon, 'AlignJustifyIcon')
export const AlignLeftIcon = createIcon(HugeAlignLeftIcon, 'AlignLeftIcon')
export const AlignRightIcon = createIcon(HugeAlignRightIcon, 'AlignRightIcon')
export const AlignStartHorizontalIcon = createIcon(
  HugeAlignStartHorizontalIcon,
  'AlignStartHorizontalIcon',
)
export const AlignStartVerticalIcon = createIcon(
  HugeAlignStartVerticalIcon,
  'AlignStartVerticalIcon',
)
export const BotIcon = createIcon(HugeBotIcon, 'BotIcon')
export const BracesIcon = createIcon(HugeBracesIcon, 'BracesIcon')
export const BringToFrontIcon = createIcon(HugeBringToFrontIcon, 'BringToFrontIcon')
export const CheckIcon = createIcon(HugeCheckIcon, 'CheckIcon')
export const ChevronDownIcon = createIcon(HugeChevronDownIcon, 'ChevronDownIcon')
export const ChevronLeftIcon = createIcon(HugeChevronLeftIcon, 'ChevronLeftIcon')
export const ChevronRightIcon = createIcon(HugeChevronRightIcon, 'ChevronRightIcon')
export const ChevronUpIcon = createIcon(HugeChevronUpIcon, 'ChevronUpIcon')
export const ChevronsUpDownIcon = createIcon(
  HugeChevronsUpDownIcon,
  'ChevronsUpDownIcon',
)
export const CircleAlertIcon = createIcon(HugeCircleAlertIcon, 'CircleAlertIcon')
export const CircleCheckIcon = createIcon(HugeCircleCheckIcon, 'CircleCheckIcon')
export const CircleIcon = createIcon(HugeCircleIcon, 'CircleIcon')
export const ClipboardIcon = createIcon(HugeClipboardIcon, 'ClipboardIcon')
export const ClipboardPasteIcon = createIcon(
  HugeClipboardPasteIcon,
  'ClipboardPasteIcon',
)
export const ClockIcon = createIcon(HugeClockIcon, 'ClockIcon')
export const CodeIcon = createIcon(HugeCodeIcon, 'CodeIcon')
export const CodeXmlIcon = createIcon(HugeCodeXmlIcon, 'CodeXmlIcon')
export const CommandIcon = createIcon(HugeCommandIcon, 'CommandIcon')
export const ComponentIcon = createIcon(HugeComponentIcon, 'ComponentIcon')
export const CopyIcon = createIcon(HugeCopyIcon, 'CopyIcon')
export const CreditCardIcon = createIcon(HugeCreditCardIcon, 'CreditCardIcon')
export const DownloadIcon = createIcon(HugeDownloadIcon, 'DownloadIcon')
export const EllipsisIcon = createIcon(HugeEllipsisIcon, 'EllipsisIcon')
export const ExternalLinkIcon = createIcon(HugeExternalLinkIcon, 'ExternalLinkIcon')
export const EyeIcon = createIcon(HugeEyeIcon, 'EyeIcon')
export const EyeOffIcon = createIcon(HugeEyeOffIcon, 'EyeOffIcon')
export const FileCode2Icon = createIcon(HugeFileCodeIcon, 'FileCode2Icon')
export const FilePlus2Icon = createIcon(HugeFilePlusIcon, 'FilePlus2Icon')
export const FolderIcon = createIcon(HugeFolderIcon, 'FolderIcon')
export const FrameIcon = createIcon(HugeFrameIcon, 'FrameIcon')
export const GitBranchIcon = createIcon(HugeGitBranchIcon, 'GitBranchIcon')
export const GitMergeIcon = createIcon(HugeGitMergeIcon, 'GitMergeIcon')
export const GithubIcon = createIcon(HugeGithubIcon, 'GithubIcon')
export const Globe2Icon = createIcon(HugeGlobeIcon, 'Globe2Icon')
export const GripVerticalIcon = createIcon(HugeGripVerticalIcon, 'GripVerticalIcon')
export const GroupIcon = createIcon(HugeGroupIcon, 'GroupIcon')
export const HandIcon = createIcon(HugeHandIcon, 'HandIcon')
export const HistoryIcon = createIcon(HugeHistoryIcon, 'HistoryIcon')
export const ImageIcon = createIcon(HugeImageIcon, 'ImageIcon')
export const ImagePlusIcon = createIcon(HugeImagePlusIcon, 'ImagePlusIcon')
export const ImportIcon = createIcon(HugeImportIcon, 'ImportIcon')
export const InfoIcon = createIcon(HugeInfoIcon, 'InfoIcon')
export const LayersIcon = createIcon(HugeLayersIcon, 'LayersIcon')
export const LayoutGridIcon = createIcon(HugeLayoutGridIcon, 'LayoutGridIcon')
export const LinkIcon = createIcon(HugeLinkIcon, 'LinkIcon')
export const Link2Icon = createIcon(HugeLinkIcon, 'Link2Icon')
export const ListIcon = createIcon(HugeListIcon, 'ListIcon')
export const ListTreeIcon = createIcon(HugeListTreeIcon, 'ListTreeIcon')
export const LockIcon = createIcon(HugeLockIcon, 'LockIcon')
export const LogOutIcon = createIcon(HugeLogOutIcon, 'LogOutIcon')
export const MaximizeIcon = createIcon(HugeMaximizeIcon, 'MaximizeIcon')
export const MinusIcon = createIcon(HugeMinusIcon, 'MinusIcon')
export const MoonIcon = createIcon(HugeMoonIcon, 'MoonIcon')
export const MoreHorizontalIcon = createIcon(
  HugeMoreHorizontalIcon,
  'MoreHorizontalIcon',
)
export const MoreHorizontal = MoreHorizontalIcon
export const MousePointer2Icon = createIcon(
  HugeMousePointerIcon,
  'MousePointer2Icon',
)
export const PanelLeftIcon = createIcon(HugePanelLeftIcon, 'PanelLeftIcon')
export const PanelBottomIcon = createIcon(HugePanelBottomIcon, 'PanelBottomIcon')
export const PanelRightIcon = createIcon(HugePanelRightIcon, 'PanelRightIcon')
export const PanelsTopLeftIcon = createIcon(
  HugePanelsTopLeftIcon,
  'PanelsTopLeftIcon',
)
export const PencilIcon = createIcon(HugePencilIcon, 'PencilIcon')
export const PlusIcon = createIcon(HugePlusIcon, 'PlusIcon')
export const QrCodeIcon = createIcon(HugeQrCodeIcon, 'QrCodeIcon')
export const RectangleHorizontalIcon = createIcon(
  HugeSquareIcon,
  'RectangleHorizontalIcon',
)
export const Redo2Icon = createIcon(HugeRedoIcon, 'Redo2Icon')
export const RefreshCwIcon = createIcon(HugeRefreshIcon, 'RefreshCwIcon')
export const RotateCcwIcon = createIcon(HugeRotateCcwIcon, 'RotateCcwIcon')
export const ScissorsIcon = createIcon(HugeScissorsIcon, 'ScissorsIcon')
export const SearchIcon = createIcon(HugeSearchIcon, 'SearchIcon')
export const SendIcon = createIcon(HugeSendIcon, 'SendIcon')
export const SendToBackIcon = createIcon(HugeSendToBackIcon, 'SendToBackIcon')
export const SettingsIcon = createIcon(HugeSettingsIcon, 'SettingsIcon')
export const Share2Icon = createIcon(HugeShareIcon, 'Share2Icon')
export const ShieldKeyIcon = createIcon(HugeShieldKeyIcon, 'ShieldKeyIcon')
export const SlidersHorizontalIcon = createIcon(
  HugeSlidersHorizontalIcon,
  'SlidersHorizontalIcon',
)
export const SquareIcon = createIcon(HugeSquareIcon, 'SquareIcon')
export const StretchHorizontalIcon = createIcon(
  HugeStretchHorizontalIcon,
  'StretchHorizontalIcon',
)
export const SunIcon = createIcon(HugeSunIcon, 'SunIcon')
export const Trash2Icon = createIcon(HugeTrashIcon, 'Trash2Icon')
export const TriangleAlertIcon = createIcon(
  HugeTriangleAlertIcon,
  'TriangleAlertIcon',
)
export const TypeIcon = createIcon(HugeTypeIcon, 'TypeIcon')
export const Undo2Icon = createIcon(HugeUndoIcon, 'Undo2Icon')
export const UngroupIcon = createIcon(HugeUngroupIcon, 'UngroupIcon')
export const UnlinkIcon = createIcon(HugeUnlinkIcon, 'UnlinkIcon')
export const Unlink2Icon = createIcon(HugeUnlink2Icon, 'Unlink2Icon')
export const UnlockIcon = createIcon(HugeUnlockIcon, 'UnlockIcon')
export const UnplugIcon = createIcon(HugeUnplugIcon, 'UnplugIcon')
export const XIcon = createIcon(HugeXIcon, 'XIcon')
export const ZoomInIcon = createIcon(HugeZoomInIcon, 'ZoomInIcon')
export const ZoomOutIcon = createIcon(HugeZoomOutIcon, 'ZoomOutIcon')
