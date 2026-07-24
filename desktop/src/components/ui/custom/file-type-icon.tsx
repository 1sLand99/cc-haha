import {
  File,
  FileArchive,
  FileAudio2,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo2,
  Folder,
  Presentation,
  type LucideIcon,
} from 'lucide-react'

import { cn } from '@/lib/utils'

const FILE_TYPE_ICONS: Record<string, LucideIcon> = {
  picture_as_pdf: FileText,
  docs: FileText,
  markdown: FileText,
  text_snippet: FileText,
  table_chart: FileSpreadsheet,
  slideshow: Presentation,
  folder_zip: FileArchive,
  code: FileCode2,
  audio_file: FileAudio2,
  video_file: FileVideo2,
  html: FileCode2,
  image: FileImage,
  folder: Folder,
  insert_drive_file: File,
}

type FileTypeIconProps = {
  icon: string
  className?: string
}

function FileTypeIcon({ icon, className }: FileTypeIconProps) {
  const Icon = FILE_TYPE_ICONS[icon] ?? File
  return (
    <Icon
      aria-hidden
      data-file-icon={icon}
      className={cn('size-[19px]', className)}
    />
  )
}

export { FileTypeIcon }
