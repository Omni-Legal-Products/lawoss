import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { parse7ZipListing, verifyNsisInstallation } from './nsis-artifact.mjs';

// Synthetic NSIS-3 Unicode archive streams compiled with electron-builder's
// checksummed NSIS 3.12 toolset. They contain inert PE headers, tiny application
// data and an ordinary embedded uninstaller file. The 512-byte PE prefix below
// is deliberately inert: these fixtures are parsed, never executed/installed.
const streams = {
  "x64": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikhPuDAz5bAwMxswMDW/n7PcPDhQ5vv+p+yIB9ZKCajWW5CPHGBqXGEo4qEoIKkmJTQviCuHKjdJa4P1V/8LBo/8PHDl58uJBCbeLGosu1h84aGB09b3t+73bbLheHfn0d8+8e+Xvdn6/U3xu7/ve9TwLrNlMNtYenWa/R5op6qYf3+EMqa+/zd0/hmuV/pA9UG22e2o9+/Ez23dJHJqRt8nh+0pz8xMfsy/kbfzrcpPzS+62eKV9Ucqfb6+oT/k9c5Noz13LRWx5fjo78jkfCTpxKLYIECSOfCye9UkkY23dvMTcz2cXP+m/8d1r6SW/r3p/3pvLmOXPervuN8ORTmPZh3suTMtN6JaVPKvCdSKx8b+nzmM2oxNKvUrrPq5z+M2x9vSeoojMDN8EtUeHV0s/3xfy8cbn/+nffnb1VV17vq/vwyIbZ/nKuOkX+u2OGDa0F0x7nvpA7nmqhuuaopBp09ujJQ6ZqBkc1fbLfy2yoCQhZdbFXsXU7OOZxeUHcvtKriltrez7apG2/79mzox5287ILWDf25M75xvvNtsdPi+XHxfJdb29Uz3VXPuspeqzh1lTlpz//Ky2NzDlTHSTVMHcXatjG2/JVAeHLbQpDZ++6OmGhG1Ljpb0fVc225dwb+5yy2+yZ76uqoxPn397qsjtgqMZ8bv02gz2FdwN/Va9pmd/cN4/luuxT0+pnk6f922NaxzHH//EzsV3+Xad+GMnXjjv66eKvEtiqcey3n1c81xn8ZqzM5dOW7J8p0dq0bPcpVKhuvN+thXuDvVfeHaJ5NOiivfrJye1yPmfXXM2dm1a5Baz/F+LKu/HX13ys/z58tt77m6M4Zo2/b3ilUk9ipmbd+v+auqVT37flflyl+nfrJ/ZaWvUEssKV8dodmTvrJoUtGXnc5vCB1t+3dxtG/Gkx/TW7pz8LFH++c/3rH0wX+5BV6/MNuONLnu7z7veOtfZ7jg7eHX02UfpD+wD6556O17pfDDF7fpLI3/LYw/nXfylfn2zoZ7wd70Xb+YkfpmZcPzuvmPN1g9SvH88e8TNqK/Z7Lt1+83X/2vE9/e+2K9ZXfrr5onTn5m+3nOOW/H4zX+Hm8v+LPmz6E3gLMl466XNRRONHH4yv2ViYDCv2rNeXYaB5YWT8btVQD4IKEMoBmm7GFnfKAayQQMD5SDAlYEhpQ1TnJuJgS4gMze3tCQxKSdVIbGgICczObEkMz9PIamyJLW4Wqk4OSM1NzEstagYKKhkpWCoo6BUUJSfUppcAuQp5SSW5xcX66akFmeX5BcoASXL4EqVDPWM9Ix1E3MKMhL1DEFy6ZklwRmJIKlEIgFIV1JpZk6Ka0F+cgbYUCNjkGBBTmJJWn5RLkioPDPP2AgkmFgEUVNhZgLiJmck5uWl5oDtAzkCJFaeX5SdlpNfHlSaF1oEllKqZWBoNGZf57+UbekktYq1q6pjp53hl/pRdElNpnHPIu8g+52uwTO+3IhRT9nItGOZS/3q+vRQ5YRlxeseM7+tNH6kds/zcFHly0cei7aKLrkS9bavUrpOin3vk99L/ZgnMjvuZCjpnRWz4tuWCJlDqqemXOPeKMr/Ta8l4O3Ftlcpu2eUtu5OdPmi86bIJXPl0ourcnsPPPLfZ5j3aVVQ0FO3iNdxXconXLLnPP7MvNuBgUGcrYmRkbNhJQM7NyMDozIzIyNrLIMAAwNPwz8uxk7WaTMgCTu1oiA1uSQ1RSE1Nyk1JQXIKM3LBNYliTk5qUWQiFWO2XsRAODKR7BvBgAA",
  "arm64": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7ziki53BoZkNgYGVWaGhrdzbH2CA0WO/3+q7NgzeZbE8uWKpY3HFA7eEOBdICEkqiwlfHnpFKapTrPrOF4Eyc4tMTDMe6e2Lk+vZYfFgo/MPefWvHoW9P/7nu9elUyvlhz+/72q6v7O7/OKz1t+32e+T6rhncSFQ98ko/9tsOHYsvGtdNNGm0ff79v33w/KP/SeIexGzdr/lj+OrzE/KnCspIt1l+fe0tky9mxvtW5vn7LV4f+Bb7VHwquP7Jv8S3rbe43VB+9sjc16kJN0cG/3UlYnDsUWAcLED3kLh0qGLeZ25zd8eHV07pfnN5ZX7d03/VXpj/v5N06+Y7v9/p0zkyz79/ayjbHhe3qEuGY8q5cqlnDkq0wJPBZ5b6qF3ZmLlnGsZ/KtZ7loPTqcPev5vqyC65//B0fXuKbbvimOd6wI8r7oPjGc/7bQ82+L+TnnHMnd8dHd9IHU2uIpRlpzJj9/+pCJLXK2Yc9nrwvPlVh3tKzqnb7zkUh6tUTvjd7kk1/WHK3l3mtxcKp+UU1nrn5f8K+Xhoc3brr6L+5sZGpmcOqUdUyZv2zS7olLFJ7bo7qS8fmK3aemrPDdZJ78U3zl7jWnpx3d0rtUd5nyHvltP1U/v7Px3ZSfvS2yb57h++43xabnN/CG93xLnZ3E8Zj7+toN95NT/9QWfEuO2X5o6upp50WOfxar1Pxg3xd5ruz3Y6XPv2OOuF47/Xjliagplqt3tq9+Vj9j1uaZC559KzEKmtlUOTvfZavk+SvbCneHfl94eYno1qiK9+snJ7bI+R9uuRkmFTltre4su+R728NMc//dPfnGLD9cZ/qkp0+rObaaJHvMLt3uGr/p5+I3c811b29ZFq9bf3bOVZUzeolTV7MVnjX1C2pLrsw6Ge+3ev7e282SUToFNnnVmyM/fsjUvcX17yUjW86zCXM7I18V2olHWqvL+c0+m3bXzP0Pj1GY4P5PVxVepRR4LX595GxwY+GO9PU/O7/k9J0+YvsyNlbTbT532Z232Uo7mL9taX2/lOmp4dLlLzdr+P//lPvLZlH9whyTl7ITwx8rvnIvr4jl2/BfNbX106xNfjcX1Cz+UxB/N3FOu2bhKf/3TAwM5lV71qvLMLBsErLUXQPkg4AyhGIokugX841iIBs0MFAOAlwZGFJWYYpzMzHQBWTm5paWJCblpCokFhTkZCYnlmTm5ykkVZakFlcrFSdnpOYmhqUWFQMFlawUDHUUlAqK8lNKk0uAPKWcxPL84mLdlNTi7JL8AiWgZBlcqZKhnpGesW5iTkFGop4hSC49syQ4IxEklUgkAOlKKs3MSXEtyE/OABtqZAwSLMhJLEnLL8oFCZVn5hkbgQQTiyBqEotyzUxAAskZiXl5qTlgMZAzQGLl+UXZaTn55UGleaFFYCmlWgaGRmP2df5L2ZZOUqtqNquOnXaGX+pH0SU1mcZ4nytMte/vlLRcupEy//fuNbrGLHPvpP8TvvH4qsHybbzTJjZ/tdDuTd3KZDpv2r8Xj2+rTP/meI0jJ461QOPWnwT+Hu/0B2did8yWO2nx6806zyVbtu5xe85/bqGGWk1u6PO/TUmH32u6p2WHurs3zWD//uHSCZlPN9rubjL09v8REfVocdDknIKV256d4F/bzszvwMAgztbEzMjZsJKBnZuRgVGZmZGRNZZBgIGBp+EfF+OFeo+TkKSdWlGQmlySmqKQmpuUmpICZJTmZQLrj8ScnNQiSNRmPJu0GgBxfv1CYwYAAA==",
  "wrong-pe": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikhZ3BoY4NgYGJWaGhrdz9vuJBIoc2y/qIZK89MglQyEfnjweoR7pxYwizouSXJw3n93Es2HThtl/lReczaph0M3QqWGSO3DoRkbPRufFHUcm3QqIXHff1viwnvKCsKia/Tc3l5/b+31O9bmd5cvmSDW8Y9nQ/9Yo+t+HZfIZqbetGR5fDbjw/4dWnffezgXMFafTNv97/kD+81bNNo1ldmIv9L5Oky36I7RNO8c+6JpT7dS3z2es3zaj1vorf459YNihndnVVw7cVDlULX7ajkOxRcCJMPGo/gHHU84L275Wtv0s15dL2ad67fXXX46rtgvW7E803224bfY7Z6bf1nzuZZ224Xs6hbhmPKpn2yzhxFf5Q+Ox0XsvGfknL3TWMz0rk/FVlP380PRscbxpxQvW/y9z9z3aPO/brvUKNquXvlx84rXJrwvdKuce2t05EcS7w3m3zNIervSnlZU72up6ElkW75n0ZZsDY96CrMep60xP3pRrSy5bHGFyd3vH+4Xs6Tuflfbpb3p7UNJL3jbNMmzbKvtVltrzzUKPPS86f+G552e783eKn+m68u5wunt1iUtu097I03s87j6N3qazLEcn2VD2+d8FZ/Vnlj/PbKq9vfmrZdXJPfobzodanzaLMrz33PyowFHxtdGJ+4+fYrF+8MZ9R16rdrjufM++57qfgl7UixjPeVt2zFXsy86O7jXTj39+ED3FcvXO48VRG3o+pRn76Tr7C288JXLm9p2wkN4KtfKe22urON6q6a64uuh3wlwd5S8VUsfObts0NfXmrUUvLz+rrQ41fnZ/7sm8z2WnizQj4xrbPU4btPVElkd/UZ1tf+ae5eU/y0ybs1izn61RCyzzXB1j2pNd9lol1XLa8mm/nm5hu7nbdsayozbHd+fkS4n2z7u8aK3AHLkHTWdlNhgbOu/tPt+a//zIYdfNmVfWGgqlTNjaxTJ1fVvg8kPBUvHLT9uISrRXf5s13+P8sx0+d4zv3ZyZ9mVnwfG7+9QOWz9wyP7iVmQasWhO1i+FU5/31/TrHf9Sespt8j2xas2yAPttp7s/2fyOD4oLvhccpik95f0UeZHvTbanIvwD6pjeMjEwmFftWa8uw8ByyopDfhWQDwLKEIph08UwOd8oBrJBAwPlIMCVgSFlFaY4NxMDXUBmbm5pSWJSTqpCYkFBTmZyYklmfp5CUmVJanG1UnFyRmpuYlhqUTFQUMlKwVBHQamgKD+lNLkEyFPKSSzPLy7WTUktzi7JL1ACSpbBlSoZ6hnpGesm5hRkJOoZguTSM0uCMxJBUolEApCupNLMnBTXgvzkDLChRsYgwYKcxJK0/KJckFB5Zp6xEUgwsQiipsLMBMRNzkjMy0vNAdsHcgRIrDy/KDstJ788qDQvtAgspVTLwNBozL7Ofynb0klqFWtXVcdOO8Mv9aPokppMY7zPFaba93dKWuYeKL3+Y72Yw/0jYpc5hTpSdofql/t/Kyqx+L7rxPl9VrnvXiepGCVN5fx7cFd0nBtD2Hs199yTri/Pme5NVH6+9aa9cd/DQOFPSkHtXA/flG0TOHDujFfn61NBSoUnvkx59efNYZdGCzdZxbfOGlzMK8X/c6hsz3PcVSLL+1b8RYJlntriP503FRgYxNmaGBk5G1YysHMzMjAqMzMyssYyCDAw8DT842J09BVigSTs1IqC1OSS1BSF1Nyk1JQUIKM0LxNYdSTm5KQWQSI22JT3LwAmMVJnXgYAAA==",
  "wrong-build": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikhZ3BoY4NgYGJWaGhrdz9vuJBIoc2y/qIZK89MglQyEfnjweoR7pxYwizouSXJw3n93Es2HThtl/lReczaph0M3QqWGSO3DoRkbPRufFHUcm3QqIXHff1viwnvKCsKia/Tc3l5/b+31O9bmd5cvmSDW8Y9nQ/9Yo+t+HZfIZqbetGR5fDbjw/4dWnffezgXMFafTNv97/kD+81bNNo1ldmIv9L5Oky36I7RNO8c+6JpT7dS3z2es3zaj1vorf459YNihndnVVw7cVDlULX7ajkOxRcCJMPGo/gHHU84L275Wtv0s15dL2ad67fXXX46rtgvW7E803224bfY7Z6bf1nzuZZ224Xs6hbhmPKpn2yzhxFf5Q+Ox0XsvGfknL3TWMz0rk/FVlP380PRscbxpxQvW/y9z9z3aPO/brvUKNquXvlx84rXJrwvdKuce2t05EcS7w3m3zNIervSnlZU72up6ElkW75n0ZZsDY96CrMep60xP3pRrSy5bHGFyd3vH+4Xs6Tuflfbpb3p7UNJL3jbNMmzbKvtVltrzzUKPPS86f+G552e783eKn+m68u5wunt1iUtu097I03s87j6N3qazLEcn2VD2+d8FZ/Vnlj/PbKq9vfmrZdXJPfobzodanzaLMrz33PyowFHxtdGJ+4+fYrF+8MZ9R16rdrjufM++57qfgl7UixjPeVt2zFXsy86O7jXTj39+ED3FcvXO48VRG3o+pRn76Tr7C288JXLm9p2wkN4KtfKe22urON6q6a64uuh3wlwd5S8VUsfObts0NfXmrUUvLz+rrQ41fnZ/7sm8z2WnizQj4xrbPU4btPVElkd/UZ1tf+ae5eU/y0ybs1izn61RCyzzXB1j2pNd9lol1XLa8mm/nm5hu7nbdsayozbHd+fkS4n2z7u8aK3AHLkHTWdlNhgbOu/tPt+a//zIYdfNmVfWGgqlTNjaxTJ1fVvg8kPBUvHLT9uISrRXf5s13+P8sx0+d4zv3ZyZ9mVnwfG7+9QOWz9wyP7iVmQasWhO1i+FU5/31/TrHf9Sespt8j2xas2yAPttp7s/2fyOD4oLvhccpik95f0UeZHvTbanIvwD6pjeMjEwmFftWa8uw8Ci5hKntQrIBwFlCMXg/v+ljW8UA9mggYFyEODKwJDShinOzcRAF5CZm1takpiUk6qQWFCQk5mcWJKZn6eQVFmSWlytVJyckZqbGJZaVAwUVLJSMNRRUCooyk8pTS4B8pRyEsvzi4t1U1KLs0vyC5SAkmVwpUqGekZ6xrqJOQUZiXqGILn0zJLgjESQVCKRAKQrqTQzJ8W1ID85A2yokTFIsCAnsSQtvygX7IjMvNIKkGBiEURNhZkJiJuckZiXl5oDtg/kCJBYeX5RdlpOfnlQaV5oEVhKqZaBodGYfZ3/Uralk9Qq1q6qjp12hl/qR9ElNZnGPYu8g+x3ugZPT3T7+vPXFt4LhoqFodXPJsw+Ml3Y+Imwh2Zi9cS9TQpvdh17oH0wO1W27bGa1nvPjJ9ry6/5KrnZVr8wsqtjk6x1E/B74nTYLYnBdEHUZufvRl+D/v3uyefqTXO4cPvkfiueaRGTxQTu8LqfkYmOkvmmvyPlA9Os+r/X36YfWhduLjhzflvbVj9gTImzNTEycjasZGDnZmRgVGZmZGSNZRBgYOBp+MfF+C1sdSEkYadWFKQml6SmKKTmJqWmpAAZpXmZwKojMScntQgSsds2/GUAACYxUmdeBgAA",
  "outer-extra": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikk3uDAzZbAwMeswMDW/n2PqLBIq03X+qHNhjlpXt5nyByZyNQ016KkOXYqDiooULI6cxhomVbT79aaHY6v0O3NLc0dLawv8bo24qfGTu7WxdqnjxVF7t+5mSZZLiV7qe1aadv2f5/V7xO8vn92YWaTFYCTsI307P+Xn4dN2CqW9fMPS8d3b8//n0D+2rVk18D0xny1+tZ68+s3yXxKIZvyIWRF+ZLf3kh2HO9Rvrgs2c/jLf/m4Yv9bwt9mr/Jv7Fq9pLTYvW9m42bPlu26ijROHYosAYeJGdV+AHMPa6PnpFvWLasz/qn7cGbVWbkEV88Hv0mWbpNN/X65lSLp/8XC50+4MnesJOhuzTRZrKPVL/ltu2K+YMrG5X0jv07oTHx37zn0+lbzwYQaXsKF83F2b70u7quM+2G88G15z7bDc99KW41M5f2l8sOqN+6LQuXkHr/mnFUx3lsROCzqklP60onJHU11PMkvynklftjkxpp7cc71q3cIcMdV1dr7V/IcN/ZMjTO9ul5l2oTXPrXDq49U5uwvaLnn3S/ZNzel/Fz5nqv9sI+Wyqx6Xn3t+3ncmK+VsdJdUQeeu1UETb4lUG4d1M5WGN056apqcnNn90uI9e27dxT3W/sFvbs/bf/6i3ed9h+zC//PczjhaMT9e3Fkkfss7pd+2YWo3hNPtD5WK7yy6+Wnms4pzSvpt/44bHL+Ztz4mxXF+944DVZU2ivtcZ26dVW1ztfK0RrrZ5CuXvpiIrva5t0c3xzW0O31X4p28q80ZxpluS4Xusr9OkVh4/LNh5rbu6Mhpa3Rn2GXf2x5umvvvruZbk/zrutMXPRWt6Nhikuwxu3S5a/yWn4ffxBqcXR9tvCJsQ9q1LKHU6VtOTT2849l2v6C25Hedfn8Lo5rf3JU7cylp5mPZbeZbu9z98w6GcfjxF5xL47sxc8biewefH9pe/Ohh080rr8KkOY1ORLg2nZp+eEXwQ83e9ZcT533qOWxb/fX8ivTiGLV3K/Pz5yd8uVlw/O4+tcPWCfXeX/q0gucF7Jqd9X7t8v8/r9UKXt4faPb6i/PG608MXy0vqyjl2/Bf9Clv6txPUzd5/py6YcmG/keBVpr7Gd8xMTCYV+1Zry7DwLKzp/3CaiAfBJQhFAObr88F3ygGskEDA+UgwJWBIaUNU5ybiYEuIDM3t7QkMSknVSGxoCAnMzmxJDM/TyGpsiS1uFqpODkjNTcxLLWoGCioZKVgqKOgVFCUn1KaXALkKeUklucXF+umpBZnl+QXKAEly+BKlQz1jPSMdRNzCjIS9QxBcumZJcEZiSCpRCIBSFdSaWZOimtBfnIG2FAjY5BgQU5iSVp+US5IqDwzz9gIJJhYBFFTYWYC4iZnJOblpeaA7QM5AiRWnl+UnZaTXx5UmhdaBJZSqmVgaDRmX+e/lG3pJLWKtauqY6ed4Zf6UXRJTaZxzyLvIPudrsEzvtyIUU/ZyLRjmUv96vr0UOWEZcXrHjO/rTR+pHbP83BR5ctHHou2ii65EvW2r1K6Top975PfS/2YJzI77mQo6Z0Vs+LblgiZQ6qnplzj3ijK/02vJeDtxbZXKbtnlLbuTnT5ovOmyCVz5dKrljfk6p957tD3eZ5jsMYzWqK3jMXqxJ40Q8P4zWxfExgYxNmaGBk5G1YxsHMzMjAqMzMyssYyCDAw8DT842K8uXRlDyRlp1YUpCaXpKYopOYmpaakABmleZnAeiQxJye1CBKzNfavRAGM/SFoawYAAA==",
  "multiple-payloads": "H4sIAAAAAAAC/+2cYUwcVRCA5zgoAjVoLNFUfqwHPUyEa+EINRcjoRT01ALhxJp6Ne7d7XEre7eb3b3eXan2aLSJPzSi1DSNUdNI09gWg9HEpmgaNP3R1BhaxRZjf1QTowaJ0TZGk+K8t3twXGmtxtg/8y3D25l5b968eW/3/i0AwNzHR853JRXFUKOmP2GYxx8AuPwQAGuz6K93ABRhexhb/INP2wBKsO3ZAJw/Oi076/93zOdhGQBOYPPL/PUDN5iZvBxyOXVigZ5G3bnMGs/a7RS2Z1DO2fpX2E4XxCopGF+O+mlsv0SZsvueu0YN2BiHfV9s50MQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQBEEQxI1nFcrLACULn2cYXvnWDvEbx9fz8/MVqD4K1vcbrjZuM7a/sg9A3FR126A9LudTlonpuGY2PaCDCv34X4Q4dIIMCkhgwEa809Hfjt44XioklvX6IFgQQ8jrx75UMSRY/4NLYhX2Gm5mX0fYlw1iDA2vBmiBZvDAetgOzLMnC9CH42QUA0zspeAlwCPQBpuhGwJ4eTBaGqUwkoiZxZfE64IkH29gLlGMJoC/IG4AMlyX+Iq2QRN4MdIm9GewbYJ1KC0YL4w+g+/YriwbJeGYJM7KaiNizDoePYUZyDyaDzWADtRZzXTUImgN88poqLN6GHyV/dwn8pzuwvt23l/n0VmkCNqWVkNCbyuPnkYb240wtrkZC21SXg65/HLzmmgXsDLWDrHx3TiviTMn+Xqi6Fd45rodPwAD2JvVm2Vm2VjGGtZLwPMi8SxlXnMBz7jKV6TwMSHU2B5FCiqj8miJhawW84kumzeb9WYo5+KEbDZ3b80TxgwFPC0hPtZcWKXBW43rMR59aVVFHp+d2XoerZevRefrsiLkNBFzEPnoep69zvv70ZrgmpQ3p1Uta06Z1yS3Og+vXNLOK75wksLoY8+374rTaq2e7UEMR6TQ7+Z7s1jx3HOs8Rms0wNwH++5gZ+JAdTd+FxI/JwIcD8fs1i3RY+1gjCviFX5pJ21zz6lhfO4eSQV82DPZv4TK/A+bCXsHVBbG8TsZXvH2b567DuAsuLcG2sHyiibrWjxLTb2D9/BEwX6TygX8/SqgpfmGtTXXuVF6kf7KZQzKDMo36NcRGEv3lLMsRKlDsWLMoeyfvvEu3XVUPzzwbX+w/YaauxYM2+G3ti05d//tmT/g9+nng6AyO4r7RVF/8/voxyPJ00xpEiCqGmKHBZNWU0IoYwpGYMuIxyT4uJjkm6g0eUTGusFl6arkWTYRM2liCnVMBoikjFgqpoLndsWuroaPU0eb4OoaDHR08h8/bIZiInMJV4nbFQoKSuRDk0Nx3jQJi8zaopoRlU9zkwpOeFtYkZRt/qkW5qZGo6JiYSk8PlYEsyWUvWBqKKmepOJPp27XM8ADHlLx7pHV4y+4k4feWdw62unKlf/rp92Vw9N7H+4t/VoR2Dvb2eDdZHxog8PbNx5aGd/X81TB4yxb52zGe8F93n/J3rmhwsP7v+g6u0vtsy+lLnz2dWlH33352iXc9jZdhTMF/cFD156//HqyTUnR6YrxqsqL3me65md2v1j5Nje5PPHRK3ssydHKyZHRlpODuqBJ070fj6Xet19755XR9YFV90Rm37vHn+rb3K8Fvfq9hW7HI6y7CEorXCAo8bpcJRshVsAVmYvlzteWFPZbh1tKa1JYVOKCFI8JEUieJNMyAnDFBVF0q2tTd99/Na/AEp4uoH+SgAA",
  "inner-link": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikhZ3BoYGNgYGJWaGhrdzfP2FA0Xa7n+aqHFMVGh638SEpA2GHgZmbswabS5HI3hn53lpBmhsecku/2qRVH2D3o0dH8Q/CPdI93KXZ4hM3JGSG7NzzXtb4+BTHCu0Y/ec//Ll3M7v84rPW34/p7OcbYE525YNscmn5e/xMOXm/G5P2CP18ff8mOP5K80fljPk36xZ/9/yx/GazC7FnswG1llL7+1y75vfXDb3LfuptAX5G/6KfLwqt/H9gn/z3rqfqjIo/9wgZTE7ouB9UmajgBOHYgth4h97X+A8pre9543PqInLL9t/bNurr78EV5U/rN+faL+7cNvcd8lM7bus5FnKNjKH7+kV4prxrF7qs4QjX2VK4LHQe1Mt7M5crIxj1XljOctB69Hh7FnP92V9OPH5f/DuGtd029fl8Y4Vcd4X3Sdej+RZIF8Yc6B2x8SrUgX9ZZZekqLnTn3+VMDcLHFcYtKeR1+2+TDmLcx6nLrO9OhNOTflMs81M+Zt7RC/2P455rPa8fAb3x7KpDbIGctoR1+Vvz4ndJpZ6LHnRf6Xn2d+3nfkTvEzXUfeHW53ry5xyZ20V/L0Ho+7T6O36SzL1ck1nPvk74az+jPLn2dOqt29+WzRl67K+LT5q8vacnckbdG/LeIsEb8jr/WvnPbj9w2b5R/vEl0Xs7VmmcW87Se8G/+rPLO4/ban+8z7YkHxSP3+54rZgc/WPJM7n3nQ6NTssyxbTWx93bSCDfK5e1eUPZp5yzhv+6vAkhlbFoVxv/9batRz4XHmDIPbXsqnN211vZx+5ve7VcvO7reevPfZ276nQZv21PAvnJbGk7n53dYX3mb1U/ZyL0udfe3L6qfrZ26e1XLz6Nqiqwrrfh7zPFWg46/78XTm183l1QbO3ap932/cexNiU+PXva2pvqrB26z4xLkjMl/l7MQjrdXl9Gaf9btb5vaHxyhMcP+nqwqvXAq8Fr/+MmM50+OC83GfhV/elJneWX1s9+7gHjvxNztuX68oYJfJ477vsY5t9RRjX3mXyo/T31/c2rHP9WbepdvK+kf1Xql/qwyMS/nvfSr7lPUpttTZn3o/NT+K23Bc8rXmKX9+ZgYG86o969VlGFg01wganWFiAANlCMWQ+oLN1DeKgWzQwEA5CHBlYEhpwxTnZmKgC8jMzS0tSUzKSVVILCjIyUxOLMnMz1NIqixJLa5WKk7OSM1NDEstKgYKKlkpGOooKBUU5aeUJpcAeUo5ieX5xcW6KanF2SX5BUpAyTK4UiVDPSM9Y93EnIKMRD1DkFx6ZklwRiJIKpFIANKVVJqZk+JakJ+cATbUyBgkWJCTWJKWX5QLEirPzDM2AgkmFkHUVJiZgLjJGYl5eak5YPtAjgCJlecXZafl5JcHleaFFoGllGqB3tZLLE4sYmBoNGZfl3u06hhz5OGaBsNcmedpy9gjMtz8rWZY/4/nrPrxWNes6p+bqEJl+hQuqbj8V+71OlNPeO9OXHFZPjXk1wcvjs1r5M68UdWaNovPMrFUdMUr3ph3F408FyxU7jVblF2x+XXd3xVmPE6iU1wu67YfZ4o2nPdb0nJZsG9O0AvjAMvXhybLXpryKTinU/yE7WpH55LSU9GpJlOuRZ6/vrEh+YZi5bqFwuGWzWyuxo+0E9SrskNYb6e+NrmdIvtTyk7/Yc4mYFyKszVxMnI2HGZg52ZkYFRmZmRkjWUQYGDgaXTiYnwmwxMKSfqpFQWpySWpKQqpuUmpKSlARmleJrBySczJSS2CRH2KcSEnAN8JqZ+ABgAA",
  "spoofed-listing": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikhZ3BoZzbAwMSswMDW/n2PqLBIq03X+qHNgzVcj7uIeB4Q5DDwOhxYwizouSYnh5z27g2bBjw+zYafxbI3rtHbiluOsZ7Q/eyNB5c0FDaeMSs7Bpr6vPn9E5zbFiqth74+pv53Z+n1d83vL7uSnBrBemMs26sW7TU/78X41i22yZDeJ4W//6r3u4/YoUh3XD9px91//J/EneZ3JE4PiV00xnA/LvqR4/H7j72DfmVOVL12/Wef3I8r2xPbD+/DflVN1Zuzf6887x1dpVvtHEkUOxRcCJMPGf2V3Tv/Har+eSaUbc/H/Xrzwbtbas45Vsy/38G6fzpqx9b6dWsODvieYTelvfd20PcGIM/vPdsFvxyQT3BqN1H9Yd+ejYd+6TVkLe9Yt2Pao1Fbyf74TzylU+/H+DL/5k5PmqO+EC88KPv1h84jVP1cVmk3OP7e6c8BLd4b1bZmlP5blTnz8VyP6VOMphtOfSl20ujHmLkh6nrjM9eVOuTbhMUme2XMQR7hfHLNdVNj8+nbO7cNol7/7IvqlrX/WvPqe1wLf14847tb9sUu+Jz6w+t+drIPO6oHJTzcDZCfnXjPSDyn9O0+3WlP6su0x4j/yWn6qf39n4bshP38borj/7u+q3nVnpN49pq/1uapN49ONR6fOb7zcaPeSz+C24zvr8VO1p51WOfxar1Pw0/6DtuTLrx0rcv2OOuF47/biSQ+fUnKt3HlvqRrhVbpZc/uzyZZdFRqyfzcL7s6znnYx9XLZazm22p/Gqqz/sYtRPc9jOayvcPHd9euS2bRm/tlTejwy9/2e38c3Ue3nReqqntb8IZNslfzi76/Qi/Zt/Er+dmylmskYyTDvGON20c7N39FOtwJjNXydPeRoxL+q+/nLTM/feHjTRFbO8l1m9OfbjD0vdW1wPXzLq3TrDaC38fUX5p50cb+ZU7Egxu116W47T+ESU66FT4YtW/F4UPCtm+WUbUYn26m9S8z3OP9vhc8f43kXDYy+KL/btrvV1Lz9wcNqP3idZG5ws735wnCJe/1Mu1vfF7Clr2faafgzKWV5X0y/+lPXb/iV7lu1ZvCZ4m8Z9DXuNd6zVPRvnLfnDEsvMwGBetWe9ugwDy3W2PUFSQD4IKEMohquCmtNL84oT01IVUitKihIVEouSMzLLgLy8kqJK3ygGskEDA+UgwJWBIaUNU5ybiYEuIDM3t7QkMSknVSGxoCAnMzmxJDM/TyGpsiS1uFqpODkjNTcxLLWoGCioZKVgqKOgVFCUn1KaXALkKeUklucXF+umpBZnl+QXKAEly+BKlQz1jPSMdRNzCjIS9QxBcumZJcEZiSCpRCIBSFdSaWZOimtBfnIG2FAjY5BgQU5iSVp+US5IqDwzz9gIJAiKVpBAhZkJiJuckZiXl5oDtg/kCJBYeX5RdlpOfnlQaV5oEVhKqZaBodGYfV3uAfFbC2t89O4fUOGbWPRUjcv+TrJh8W+mSgvBqxdO+X1kXRF+J+d5vWbl5LjJth2vLcUrmqbWdW9x51p/6NisU0Vpf2ZOT68WXXlfvyP237czl0Od3s5cecHx6rUzwfJr43vsflqVsbNmO3349OZ8V8bO+oeRz7ctPhfz53PHNJmDNjbV14/Md1WrD4nkqPLbMeunkc2a+1fra2aYip/Iu/myR7LjhLtFcX+BatO2g33Xp8pKTFqvaHgmdM9rI+72n19S9uqeq7LsNOnStZNwtDghfuvJ9OzL8xNvcehrpIt5LJhVYy4387tpiVfGG+4L/7c4iImrsW6snHFAwWFDzy8eYPyLszVJM3I2/Gdg52ZkYFRmZmRkjWUQYGDgaTzFxfj7ULkJJCOlVhSkJpekpiik5ialpqQAGaV5mcCqKjEnJ7UIklyuHtn0CACq+ywIzgYAAA==",
  "compressed-uninstaller": "H4sIAAAAAAAC/2NgYGB4v2/tPb/SnJzi/LQSz7zikhZ3BoYLbAwMsswMDW/n2PqLBIq03X+6WGDr5Qgrt6bOg72OTYXJJg1JHiE9GRnbJKexhouVbZZnOpZk+o9BM0Onx75hfkKOiVhZhsjEiCDp5MSd+76fOfPOiClr6dHfZ+btLX639/md4nN7jZ9eYfii1mC2bXXOz8OvHRc05/4X6Jmu7Pj/sfYP3a9iTXwPeGfnf7Vn/z/jvK6hiyHvBofyldvfT3i8fENs8u95mwRfvc6xP1ZTeuzN7hX7k383bhI7d/fGYrZzaoL3dkfsUmwRcOIgTHT8b3Seou6Q/vgzz2n2efYf9quYvf76q27VdoGa/Ynmuzm33b+97bbqt5iPbF4aCW3/7Z4ZNMl8OrGox3uPdmHNjMXFe7hm3C80aS05037d6Hxt76OF4n+Wb//ZdT7qXXm8Y0WU92X3idc1eRbIe845Wrtj4lSpgtllll6SoudOff5UINo844DEsUrVl7kTmWLcrx47HZM9a7Ntz7E3xzamVF1T2tduN+fhrOsW+45s41+uyfxlxsOIm6v+rXi2ZtOWlUZ203f7z1c/85up+PzM7SKmD4xKwycLbdX8lqbzWal0ev7NTTM2Gt5Psjr2O3F2vNH7c5dFfm9Ln/30hevnfSfswt/y3M44WhG/TbVNY1/GXa7ftmFqNxjT7Y+VasfszPrpU2yTP3G60//HM57mbDfW27TgvGtMyl6bee1rXGdunlVts5z1tEa+2eQrNVWzukKXJdx7Jh1o+njmPcO87a8cS2ZuWRzW/a651KjnwuPMGSa3vZRPb9rqevn9jO9vQ7+e3W89ee+zt8ueBm3aw8Q/8Zkx2/011bq/Jp2VT32/J/PmNNPmLNbsZ2vUAss8V8eY9mSvK5xkJHM62PtvUVTzm7tydxYeZTpenZM/S7R/3uVFawXmyD3Yc1Zmk7Gh9972867XznW2c6ddXhNdrHJCIVmUUyued7Ff63KTfX79lVoGfN/fbLWbOO9s4cwd6Xt2W599Ufywb3etb1v5gX19L3qfZG1wsrx5rcbb9vfp7y+yfO4vydn6Yu7G6Y8SX7mXVwbOS/7PfUr7VPQpq9TuT1M/NT+K2+Au8brwlP97JgYG86o969VlGFjerdD3XAPkg4AyhGK4NT9pnm8UA9mggYFyEODKwJDShinOzcRAF5CZm1takpiUk6qQWFCQk5mcWJKZn6eQVFmSWlytVJyckZqbGJZaVAwUVLJSMNRRUCooyk8pTS4B8pRyEsvzi4t1U1KLs0vyC5SAkmVwpUqGekZ6xrqJOQUZiXqGILn0zJLgjESQVCKRAKQrqTQzJ8W1ID85A2yokTFIsCAnsSQtvygXJFSemWdsBBJMLIKoqTAzAXGTMxLz8lJzwPaBHAESK88vyk7LyS8PKs0LLQJLKdUyMDQas6/zX8q2dJJaxdpV1bHTzvBL/Si6pCbTuGeRd5D9TtfgGV9uxKinbGTascylfnV9eqhywrLidY+Z31YaP1K753m4qPLlI49FW0WXXIl621cpXSfFvvfJ76V+zBOZHXcylPTOilnxbUuEzCHVU1OucW8U5f+m1xLw9mLbq5TdM0pbdycWcJ6NW8p9aMoUs1PVRcHRx4LOvy+fo2YxdfIUgxgRiYxrm7Q97a0ObVQBxpU4WxMjI2fDagZ2bkYGRmVmRkbWWAYBBgaehn9cjJ2q/M4MDDOAqfLtqY2cDQYMLAdCN80yjOcIdFF+8c2q7WhpeMw7288e2pHZUb8Lck+X9a38LrPUTjldxDWQ9uineyXj9vot6wCbG9iv0AYAAA=="
};
const r0Streams = JSON.parse(await readFile(new URL('./fixtures/nsis-r0-streams.json', import.meta.url), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uninstaller = 'expected embedded uninstaller bytes';
function pe(machine = 0x8664) {
  const bytes = Buffer.alloc(256);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE(machine, 132); bytes.writeUInt16LE(0x20b, 152);
  return bytes;
}
async function fixture(t, variant = 'x64') {
  const root = await mkdtemp(join(tmpdir(), 'lawoss-nsis-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const arch = variant === 'arm64' ? 'arm64' : 'x64', installed = join(root, 'installed');
  await mkdir(join(installed, 'resources'), { recursive: true });
  const installedApp = join(installed, 'LAWOSS.exe');
  await writeFile(installedApp, pe(arch === 'arm64' ? 0xaa64 : 0x8664));
  await writeFile(join(installed, 'resources/app.asar'), 'immutable application bytes');
  await writeFile(join(installed, 'resources/build-info.json'), `{"schemaVersion": 1, "product": "lawoss-desktop", "version": "1.2.3-alpha.1", "gitSha": "${'a'.repeat(40)}", "buildEpoch": "123", "platform": "win32", "arch": "${arch}", "channel": "alpha", "workflowRunUrl": ""}`);
  await writeFile(join(installed, 'Uninstall LAWOSS.exe'), variant === 'compressed-uninstaller' || variant in r0Streams ? uninstaller.repeat(1000) : uninstaller);
  if (variant === 'x64') await writeFile(join(installed, 'uninstallerIcon.ico'), uninstaller);
  const asset = join(root, 'candidate.exe'), prefix = Buffer.alloc(512);
  pe(0x14c).copy(prefix);
  const bytes = Buffer.concat([prefix, gunzipSync(Buffer.from(streams[variant] ?? r0Streams[variant], 'base64'))]);
  await writeFile(asset, bytes);
  return { root, installed, arch, installedApp, asset, expectedSha256: hash(bytes) };
}

test('NSIS x64 and ARM64 archives authenticate exact installed bytes and installer extras without signing claims', async t => {
  for (const arch of ['x64', 'arm64']) await t.test(arch, async t => {
    const f = await fixture(t, arch);
    assert.deepEqual(await verifyNsisInstallation(f), {
      status: 'verified', method: 'sha256-nsis-installed-tree', signing: 'not-asserted', assetSha256: f.expectedSha256,
    });
  });
});
test('compressed outer uninstallers with unknown listed size are bounded and authenticated by actual bytes', async t => {
  const f = await fixture(t, 'compressed-uninstaller');
  assert.equal((await verifyNsisInstallation(f)).status, 'verified');
  await writeFile(join(f.installed, 'Uninstall LAWOSS.exe'), 'changed');
  await assert.rejects(verifyNsisInstallation(f), /installed.*(tree|payload|bytes)/i);
});

test('real NSIS runtime-variable uninstaller paths authenticate the installed basename and reject ambiguous aliases', async t => {
  const f = await fixture(t, 'r0-uninstaller');
  assert.equal((await verifyNsisInstallation(f)).status, 'verified');
  await writeFile(join(f.installed, 'Uninstall LAWOSS.exe'), 'changed');
  await assert.rejects(verifyNsisInstallation(f), /installed.*(tree|payload|bytes)/i);
  const ambiguous = await fixture(t, 'ambiguous-root-and-r0');
  await assert.rejects(verifyNsisInstallation(ambiguous), /ambiguous.*uninstaller/i);
});
test('a different target archive, PE machine or embedded build target refuses verification', async t => {
  await t.test('wrong archive', async t => {
    const f = await fixture(t);
    await assert.rejects(verifyNsisInstallation({ ...f, arch: 'arm64' }), /architecture|payload/i);
  });
  for (const variant of ['wrong-pe', 'wrong-build']) await t.test(variant, async t => {
    const f = await fixture(t, variant);
    await assert.rejects(verifyNsisInstallation(f), /architecture|build target/i);
  });
});
test('unsupported final NSIS layouts, inner links and forged listing records cannot authorize extraction', async t => {
  for (const [variant, reason] of [
    ['outer-extra', /outer archive/i], ['multiple-payloads', /architecture payload/i],
    ['inner-link', /archive|link/i], ['spoofed-listing', /installed.*missing/i],
  ]) await t.test(variant, async t => {
    const f = await fixture(t, variant), before = await readFile(f.installedApp);
    await assert.rejects(verifyNsisInstallation(f), reason);
    assert.deepEqual(await readFile(f.installedApp), before);
  });
});
test('changed, missing, extra or replaced installed files cannot be ignored', async t => {
  const mutations = {
    application: f => writeFile(join(f.installed, 'resources/app.asar'), 'changed'),
    uninstaller: f => writeFile(join(f.installed, 'Uninstall LAWOSS.exe'), 'changed'),
    icon: f => writeFile(join(f.installed, 'uninstallerIcon.ico'), 'changed'),
    'missing-uninstaller': f => rm(join(f.installed, 'Uninstall LAWOSS.exe')),
    'missing-application': f => rm(join(f.installed, 'resources/app.asar')),
    'extra-executable': f => writeFile(join(f.installed, 'arbitrary.exe'), 'extra'),
    'extra-directory': f => mkdir(join(f.installed, 'extra')),
    hardlink: f => link(join(f.installed, 'resources/app.asar'), join(f.root, 'unowned-alias')),
  };
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async t => {
    const f = await fixture(t); await mutate(f);
    await assert.rejects(verifyNsisInstallation(f), /installed.*(tree|payload|bytes)/i);
  });
});
test('a wrong final digest and a non-NSIS artifact refuse without modifying the installation', async t => {
  const f = await fixture(t), before = await readFile(f.installedApp);
  await assert.rejects(verifyNsisInstallation({ ...f, expectedSha256: '0'.repeat(64) }), /digest/i);
  await writeFile(f.asset, before);
  await assert.rejects(verifyNsisInstallation({ ...f, expectedSha256: hash(before) }), /NSIS|archive/i);
  assert.deepEqual(await readFile(f.installedApp), before);
});
test('links in the installed payload refuse verification', { skip: process.platform === 'win32' ? 'Creating file symlinks requires a separately provisioned Windows privilege' : false }, async t => {
  const f = await fixture(t);
  await rm(join(f.installed, 'resources/app.asar'));
  await symlink(f.asset, join(f.installed, 'resources/app.asar'));
  await assert.rejects(verifyNsisInstallation(f), /installed.*(link|entry|payload)/i);
});

const entry = (path, extra = '') => `Path = ${path}\nSize = 1\nPacked Size = 1\nAttributes = A\nEncrypted = -\n${extra}`;
const listing = (entries, type = '7z') => `7-Zip\n\n--\nPath = candidate\nType = ${type}\nPhysical Size = 123\n\n----------\n${entries.join('\n')}`;
test('technical listings preserve literal selectors and refuse aliases before any extraction', () => {
  assert.deepEqual(parse7ZipListing(listing([entry('resources\\app.asar')]), '7z'), [
    { path: 'resources/app.asar', rawPath: 'resources\\app.asar', kind: 'file', size: 1 },
  ]);
  const unsafe = ['../escape', '/absolute', 'C:\\escape', 'resources/file:stream', 'resources/CON.txt', 'CONIN$', 'CONOUT$.txt', 'LPT1', 'com¹.txt', 'trailing.', 'trailing ', 'double//path', 'a/./b', 'a/../b', 'wild*card', 'question?mark', 'decomposed-e\u0301', 'line\nPath = forged'];
  for (const path of unsafe) assert.throws(() => parse7ZipListing(listing([entry(path)]), '7z'), /archive|listing|path/i, path);
  for (const entries of [
    [entry('same'), entry('same')], [entry('Resources/a'), entry('resources/b')],
    [entry('a'), entry('a/child')], [entry('file', 'Symbolic Link = elsewhere\n')],
    [entry('file', 'Hard Link = elsewhere\n')], [entry('file', 'Reparse Point = +\n')],
    [entry('file').replace('Attributes = A', 'Attributes = A lrwxrwxrwx')],
    [entry('file').replace('Encrypted = -', 'Encrypted = +')],
    [entry('file').replace('Size = 1', 'Size = 34359738369')],
    [entry('file').replace('Size = 1', 'Size = -1')], [entry('file', 'Size = 1\n')],
  ]) assert.throws(() => parse7ZipListing(listing(entries), '7z'), /archive|listing|path|budget/i);
  assert.throws(() => parse7ZipListing(listing([entry('safe')], 'zip'), 'Nsis'), /archive|NSIS/i);
});
test('aggregate decompression size and archive entry count remain bounded', () => {
  assert.throws(() => parse7ZipListing(listing([
    entry('a').replace('Size = 1', 'Size = 20000000000'),
    entry('b').replace('Size = 1', 'Size = 20000000000'),
  ]), '7z'), /budget/i);
  assert.throws(() => parse7ZipListing(listing(Array.from({ length: 100001 }, (_, i) => entry(`f${i}`))), '7z'), /budget/i);
});
