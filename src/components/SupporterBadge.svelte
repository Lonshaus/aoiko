<script lang="ts">
  interface Props {
    owned: boolean;
  }

  let { owned }: Props = $props();
</script>

<span class="badge" class:owned aria-hidden="true">
  <span class="badge-face">
    <!-- aoiko のロゴにある肉球。PNG の輪郭を実測して起こしたもの。 -->
    <svg class="emblem" viewBox="0 0 64 64">
      <path
        d="M26.8 26.1 L27.5 26.4 L30.0 28.8 L31.4 28.6 L32.7 28.6 L34.0 28.8 L36.6 26.3 L37.0 26.1 L37.4 26.3 L37.4 28.9 L37.1 30.4 L37.6 31.7 L37.7 33.4 L37.1 35.3 L36.0 36.8 L37.1 38.6 L38.1 41.4 L38.9 44.9 L39.2 46.8 L39.2 48.1 L38.8 49.5 L38.1 50.2 L37.2 50.5 L36.1 50.8 L33.9 51.0 L30.2 51.0 L27.9 50.8 L27.0 50.6 L25.9 50.2 L25.2 49.5 L25.0 49.0 L24.8 48.2 L24.8 46.6 L25.2 43.8 L26.5 39.7 L27.4 37.7 L28.0 36.7 L27.0 35.4 L26.6 34.5 L26.3 33.5 L26.3 32.1 L26.8 30.5 L26.5 28.1 L26.6 26.5Z"
      />
      <path
        d="M31.7 18.2 L32.8 18.3 L33.6 18.8 L34.0 19.1 L34.8 20.5 L36.1 21.8 L36.4 22.5 L36.4 23.3 L36.1 24.0 L35.3 24.6 L34.2 24.7 L32.3 24.3 L31.4 24.3 L29.9 24.7 L29.0 24.7 L28.3 24.5 L27.8 23.9 L27.6 23.4 L27.6 22.5 L27.9 21.8 L29.2 20.5 L29.7 19.5 L30.4 18.8Z"
      />
      <path
        d="M36.9 16.4 L37.8 16.5 L38.4 17.1 L38.6 17.7 L38.6 18.4 L38.2 19.4 L37.5 20.2 L37.0 20.4 L36.5 20.5 L35.9 20.2 L35.4 19.3 L35.4 18.2 L35.6 17.7 L36.3 16.7Z"
      />
      <path
        d="M26.5 16.4 L27.1 16.4 L27.6 16.6 L28.2 17.3 L28.6 18.1 L28.6 19.4 L28.3 20.0 L27.7 20.4 L27.2 20.5 L26.4 20.1 L25.8 19.4 L25.5 18.7 L25.4 17.9 L25.6 17.2 L26.1 16.6Z"
      />
      <path
        d="M29.7 13.0 L30.4 13.1 L31.0 13.7 L31.3 14.1 L31.5 14.9 L31.5 15.6 L31.1 16.6 L30.7 17.0 L30.3 17.2 L29.6 17.1 L29.0 16.5 L28.5 15.3 L28.6 14.1 L28.9 13.6 L29.3 13.2Z"
      />
      <path
        d="M34.0 13.0 L34.4 13.0 L34.9 13.3 L35.5 14.3 L35.4 15.9 L35.1 16.4 L34.6 17.0 L34.1 17.2 L33.4 17.1 L32.9 16.6 L32.5 15.3 L32.6 14.6 L33.0 13.7 L33.5 13.2Z"
      />
    </svg>
  </span>
</span>

<style>
  /* 縁の形を差し替えられるよう、外周と盤面を別の層に分ける。border で縁を作ると
     多角形にしたとき幅が一定にならない。未購入のあいだは灰へ落として沈ませる。 */
  .badge {
    position: relative;
    display: block;
    width: 3.375rem;
    height: 3.375rem;
    filter: grayscale(1) brightness(0.72);
    opacity: 0.38;
  }
  .badge::before {
    content: '';
    position: absolute;
    inset: 0;
    background-image: linear-gradient(
      135deg,
      #ffffff 0%,
      #e7e9ff 10%,
      #6f7ab4 24%,
      #ffffff 38%,
      #b3bbe6 50%,
      #4f5a92 62%,
      #f2f4ff 78%,
      #8f99cf 90%,
      #ffffff 100%
    );
  }
  .badge::before,
  .badge-face,
  .badge-face::after {
    border-radius: 50%;
  }
  .badge-face {
    position: absolute;
    inset: 0.22rem;
    display: grid;
    place-items: center;
    overflow: hidden;
    background-image: radial-gradient(
      125% 125% at 30% 20%,
      #ffffff 0%,
      #f2f0ff 22%,
      #c4c9f0 48%,
      #8b93cc 74%,
      #dfe2fb 100%
    );
    box-shadow:
      inset 0 1px 1px rgb(255 255 255 / 60%),
      inset 0 -2px 4px rgb(40 48 96 / 32%);
  }
  /* 放射状の磨き跡。白金だけの飾り。 */
  .badge-face::before {
    content: '';
    position: absolute;
    inset: 0;
    background: conic-gradient(
      from 208deg,
      rgb(255 255 255 / 0) 0deg,
      rgb(255 255 255 / 60%) 22deg,
      rgb(255 255 255 / 0) 54deg,
      rgb(120 132 200 / 38%) 112deg,
      rgb(190 235 255 / 30%) 150deg,
      rgb(255 255 255 / 0) 172deg,
      rgb(255 255 255 / 66%) 206deg,
      rgb(255 255 255 / 0) 244deg,
      rgb(178 150 230 / 32%) 296deg,
      rgb(120 132 200 / 30%) 322deg,
      rgb(255 255 255 / 0) 360deg
    );
  }
  .badge-face::after {
    content: '';
    position: absolute;
    inset: 0.19rem;
    border: 1px solid rgb(255 255 255 / 60%);
    box-shadow: inset 0 0 0 1.5px rgb(72 82 138 / 30%);
  }
  .emblem {
    position: relative;
    display: block;
    width: 2.75rem;
    height: 2.75rem;
    fill: rgb(38 42 78 / 52%);
    filter: drop-shadow(0 1px 0 rgb(255 255 255 / 78%));
  }
  .badge.owned {
    filter: drop-shadow(0 2px 6px rgb(78 92 180 / 50%));
    opacity: 1;
  }
</style>
