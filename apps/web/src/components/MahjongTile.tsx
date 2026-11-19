import { TILE_SUIT, tileLabel } from '../lib/tiles'

interface Props {
  tile: string
  small?: boolean
  back?: boolean
  selectable?: boolean
  selected?: boolean
  onClick?: () => void
}

export default function MahjongTile({ tile, small, back, selectable, selected, onClick }: Props) {
  if (back) return <div className={`mahjong-tile back ${small ? 'small' : ''}`} />
  const suit = TILE_SUIT[tile] ?? 'wan'
  const cls = ['mahjong-tile', `suit-${suit}`, tile, small ? 'small' : '', selectable ? 'selectable' : '', selected ? 'selected' : ''].filter(Boolean).join(' ')
  const num = parseInt(tile.slice(1), 10)

  let inner
  if (suit === 'tong') {
    const dots = Math.min(num, 9)
    inner = <div className="tong-dots">{Array.from({ length: dots }, (_, i) => <i key={i} />)}</div>
  } else if (suit === 'tiao') {
    const bars = Math.min(num, 9)
    inner = <div className="tiao-bars">{Array.from({ length: bars }, (_, i) => <i key={i} style={{ height: `${8 + (i % 3) * 5}px` }} />)}</div>
  } else {
    inner = <span className="tile-main">{tileLabel(tile)}</span>
  }

  return (
    <div className={cls} onClick={onClick} title={tile}>
      {inner}
      {suit !== 'zi' && <span className="tile-sub">{suit === 'wan' ? '萬' : suit === 'tiao' ? '索' : '筒'}</span>}
    </div>
  )
}
