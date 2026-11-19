const BASE = import.meta.env.BASE_URL || '/'
/** 复用旧版 H5 的美术素材 */
export const asset = (p: string) => `${BASE}assets/${p}`

export const IMG = {
  loginBg: asset('login/main_bg.jpg'),
  logo: asset('login/logo.png'),
  loginBtn: asset('login/loginBtn1.png'),
  unameIcon: asset('login/unameIcon.png'),
  pwdIcon: asset('login/passwordIcon.png'),
  lobbyBg: asset('main/game_scene.jpg'),
  tableBg: asset('card/game_bg.jpg'),
  roomNormal: asset('main/normalRoom.png'),
  roomMiddle: asset('main/middleRoom.png'),
  roomHigh: asset('main/highRoom.png'),
  currency: asset('main/currency_icon.png'),
  roomcard: asset('main/money_icon.png'),
  head: asset('main/head_001.png'),
  music: asset('music/music_scene.mp3'),
  musicGame: asset('music/music_game.mp3'),
}
