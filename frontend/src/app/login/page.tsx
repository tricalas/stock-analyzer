'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { TrendingUp, Sparkles, Lock, User, ArrowRight, Shield } from 'lucide-react';

export default function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [nickname, setNickname] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);

  // Redirect if already authenticated
  useEffect(() => {
    if (!loading && isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, loading, router]);

  const handlePinChange = (value: string) => {
    // Only allow digits, max 6 characters
    const digitsOnly = value.replace(/\D/g, '').slice(0, 6);
    setPin(digitsOnly);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!nickname || nickname.trim().length < 2) {
      toast.error('닉네임을 입력해주세요.');
      return;
    }

    if (pin.length !== 6) {
      toast.error('PIN은 6자리 숫자여야 합니다.');
      return;
    }

    setIsSubmitting(true);

    try {
      await login(nickname.trim(), pin);
      toast.success('로그인 성공!');
    } catch (error: any) {
      toast.error(error.message || '닉네임 또는 PIN이 올바르지 않습니다.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
        <div className="relative">
          <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500"></div>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <TrendingUp className="w-6 h-6 text-blue-400 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-gradient-to-br from-slate-950 via-blue-950 to-slate-950">
      <Toaster />

      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Grid Pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a_1px,transparent_1px),linear-gradient(to_bottom,#0f172a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000,transparent)]" />

        {/* Floating Orbs - Static */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-500/20 rounded-full blur-[100px]" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-purple-500/20 rounded-full blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* Logo with Animation */}
          <div className="text-center mb-8 animate-fade-in-down">
            <div className="relative inline-block mb-6">
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500 to-purple-500 rounded-3xl blur-xl opacity-50" />
              <div className="relative bg-gradient-to-br from-blue-500/20 to-purple-500/20 backdrop-blur-sm border border-blue-500/30 rounded-3xl p-4">
                <TrendingUp className="w-12 h-12 text-blue-400" />
                <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-yellow-400" />
              </div>
            </div>

            <h1 className="text-5xl font-bold bg-gradient-to-r from-blue-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-3">
              오스카투자
            </h1>
            <p className="text-blue-300/80 text-sm font-medium flex items-center justify-center gap-2">
              <Shield className="w-4 h-4" />
              안전한 PIN 로그인
            </p>
          </div>

          {/* Login/Register Form */}
          <div className="relative group animate-fade-in-up">
            {/* Glow Effect */}
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500 to-purple-500 rounded-3xl blur opacity-30 group-hover:opacity-50 transition duration-500" />

            <div className="relative bg-slate-900/80 backdrop-blur-xl border border-blue-500/20 rounded-3xl shadow-2xl p-8">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="animate-slide-in">
                  <label htmlFor="nickname" className="block text-sm font-semibold text-blue-300 mb-3 flex items-center gap-2">
                    <User className="w-4 h-4" />
                    닉네임
                  </label>
                  <div className={`relative transition-all duration-300 ${focusedInput === 'nickname' ? 'scale-[1.02]' : ''}`}>
                    <input
                      type="text"
                      id="nickname"
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      onFocus={() => setFocusedInput('nickname')}
                      onBlur={() => setFocusedInput(null)}
                      placeholder="닉네임 입력"
                      className="w-full px-5 py-4 bg-slate-800/50 border-2 border-blue-500/30 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-white placeholder:text-slate-500 transition-all duration-300"
                      disabled={isSubmitting}
                      maxLength={50}
                    />
                    {nickname && (
                      <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                        <div className="w-2 h-2 bg-green-400 rounded-full" />
                      </div>
                    )}
                  </div>
                </div>

                <div className="animate-slide-in delay-100">
                  <label htmlFor="pin" className="block text-sm font-semibold text-blue-300 mb-3 flex items-center gap-2">
                    <Lock className="w-4 h-4" />
                    PIN 코드 (6자리)
                  </label>
                  <div className={`relative transition-all duration-300 ${focusedInput === 'pin' ? 'scale-[1.02]' : ''}`}>
                    <input
                      type="password"
                      id="pin"
                      value={pin}
                      onChange={(e) => handlePinChange(e.target.value)}
                      onFocus={() => setFocusedInput('pin')}
                      onBlur={() => setFocusedInput(null)}
                      placeholder="••••••"
                      className="w-full px-5 py-4 bg-slate-800/50 border-2 border-blue-500/30 rounded-xl focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-white placeholder:text-slate-500 text-center text-3xl tracking-[0.5em] font-mono transition-all duration-300"
                      disabled={isSubmitting}
                      maxLength={6}
                      inputMode="numeric"
                    />

                    {/* PIN Progress Dots */}
                    <div className="flex justify-center gap-2 mt-4">
                      {[...Array(6)].map((_, i) => (
                        <div
                          key={i}
                          className={`w-3 h-3 rounded-full transition-all duration-300 ${
                            i < pin.length
                              ? 'bg-gradient-to-r from-blue-500 to-purple-500 scale-110 shadow-lg shadow-blue-500/50'
                              : 'bg-slate-700/50'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || pin.length !== 6 || nickname.trim().length < 2}
                  className="group relative w-full overflow-hidden bg-gradient-to-r from-blue-600 to-purple-600 text-white py-4 rounded-xl font-bold text-lg shadow-lg shadow-blue-500/30 hover:shadow-xl hover:shadow-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer transition-all duration-300 hover:scale-[1.02] active:scale-95"
                >
                  {/* Button Shine Effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent translate-x-[-200%] group-hover:translate-x-[200%] transition-transform duration-1000" />

                  <span className="relative flex items-center justify-center gap-2">
                    {isSubmitting ? (
                      <>
                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                        처리 중...
                      </>
                    ) : (
                      <>
                        로그인
                        <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </span>
                </button>
              </form>
            </div>
          </div>

          {/* Info */}
          <div className="mt-6 text-center animate-fade-in-up delay-200">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500/10 backdrop-blur-sm border border-blue-500/20 rounded-full">
              <Shield className="w-4 h-4 text-blue-400" />
              <p className="text-xs text-blue-300/80 font-medium">
                PIN은 안전하게 암호화되어 저장됩니다
              </p>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.5); }
        }

        @keyframes fade-in-down {
          0% {
            opacity: 0;
            transform: translateY(-20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-in-up {
          0% {
            opacity: 0;
            transform: translateY(20px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slide-in {
          0% {
            opacity: 0;
            transform: translateX(-20px);
          }
          100% {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .animate-twinkle {
          animation: twinkle 3s ease-in-out infinite;
        }

        .animate-fade-in-down {
          animation: fade-in-down 0.6s ease-out;
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.6s ease-out;
        }

        .animate-slide-in {
          animation: slide-in 0.6s ease-out;
        }

        .animate-gradient {
          background-size: 200% 200%;
          animation: gradient 3s ease infinite;
        }

        .delay-100 {
          animation-delay: 0.1s;
        }

        .delay-200 {
          animation-delay: 0.2s;
        }

        .delay-500 {
          animation-delay: 0.5s;
        }

        .delay-1000 {
          animation-delay: 1s;
        }
      `}</style>
    </div>
  );
}
